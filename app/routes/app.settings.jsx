/**
 * Settings page for the Astro Advice lead pipeline — lets you set the
 * Gmail sending credentials and Google Sheets mirror target from the
 * app's own UI instead of editing Render's Environment tab. A value
 * saved here takes priority over the matching env var (see
 * app/utils/appSettings.server.js), so either place works.
 *
 * The two genuinely secret fields (Gmail App Password, Google service
 * account private key) are never re-displayed once saved — the form
 * shows a "•••• already set" placeholder instead, and leaving that field
 * blank on save keeps the existing value rather than clearing it.
 */
import crypto from "node:crypto";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getRawAppSettingsRow,
  saveAppSettings,
  getAppSettings,
  DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS,
  DEFAULT_INTERAKT_TEMPLATE_NAME,
  DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME,
  DEFAULT_INTERAKT_WISHLIST_TEMPLATE_NAME,
  DEFAULT_ORDER_PROCESSING_TRIGGER_TAG,
  DEFAULT_WHATSAPP_INTERVAL_VALUE,
  DEFAULT_WHATSAPP_INTERVAL_UNIT,
} from "../utils/appSettings.server";
import { FALLBACK_LOGO_URL } from "../utils/astroAdvice.server";
import { sendGemRecommendationWhatsApp, getOrCreateInteraktCampaignId, sendOrderProcessingWhatsApp, sendWishlistWhatsApp } from "../utils/interakt.server";
import { checkGmail, checkGoogleSheets, checkInterakt, checkGooglePlaces } from "../utils/serviceHealth.server";
import { getOrderProcessingEmailTemplate, ORDER_PROCESSING_EMAIL_PLACEHOLDERS } from "../utils/orderProcessingEmail.server";
import { brand, Icon, Card, PageHeader, PageIn } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const row = await getRawAppSettingsRow(session.shop);
  const settings = await getAppSettings(session.shop);

  // Live "is this actually working" check per service — same functions
  // the Server page uses, run here too so each card can show its own
  // Connected/Not connected/Failing badge instead of making you dig
  // through a separate page to find out.
  const [gmailStatus, sheetsStatus, interaktStatus, placesStatus] = await Promise.all([
    checkGmail(settings),
    checkGoogleSheets(settings),
    checkInterakt(settings),
    checkGooglePlaces(settings),
  ]);

  return {
    serviceStatus: {
      gmail: gmailStatus,
      sheets: sheetsStatus,
      interakt: interaktStatus,
      places: placesStatus,
    },
    gmailUser: row?.gmailUser || "",
    gmailAppPasswordSet: !!row?.gmailAppPassword,
    googleServiceAccountEmail: row?.googleServiceAccountEmail || "",
    googleServiceAccountPrivateKeySet: !!row?.googleServiceAccountPrivateKey,
    astroLeadsSpreadsheetId: row?.astroLeadsSpreadsheetId || "",
    sheetsRelayUrl: row?.sheetsRelayUrl || "",
    sheetsRelaySecretSet: !!row?.sheetsRelaySecret,
    wishlistEmailIntervalHours: row?.wishlistEmailIntervalHours || String(DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS),
    interaktApiKeySet: !!row?.interaktApiKey,
    interaktTemplateName: row?.interaktTemplateName || "",
    defaultInteraktTemplateName: DEFAULT_INTERAKT_TEMPLATE_NAME,
    interaktOrderTemplateName: row?.interaktOrderTemplateName || "",
    defaultInteraktOrderTemplateName: DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME,
    orderProcessingTriggerTag: row?.orderProcessingTriggerTag || "",
    defaultOrderProcessingTriggerTag: DEFAULT_ORDER_PROCESSING_TRIGGER_TAG,
    interaktWishlistTemplateName: row?.interaktWishlistTemplateName || "",
    defaultInteraktWishlistTemplateName: DEFAULT_INTERAKT_WISHLIST_TEMPLATE_NAME,
    whatsappIntervalValue: row?.whatsappIntervalValue || DEFAULT_WHATSAPP_INTERVAL_VALUE,
    whatsappIntervalUnit: row?.whatsappIntervalUnit || DEFAULT_WHATSAPP_INTERVAL_UNIT,
    interaktWebhookSecretSet: !!row?.interaktWebhookSecret,
    googlePlacesApiKeySet: !!row?.googlePlacesApiKey,
    // Empty string means "using the built-in default" -- the textarea
    // shows defaultOrderProcessingEmailTemplate as its starting value in
    // that case (see getOrderProcessingEmailTemplate, the one place
    // this same fallback decision is made server-side too), so what's
    // shown here always matches what would actually send.
    orderProcessingEmailTemplate: row?.orderProcessingEmailTemplate || "",
    defaultOrderProcessingEmailTemplate: getOrderProcessingEmailTemplate({}),
    orderProcessingEmailPlaceholders: ORDER_PROCESSING_EMAIL_PLACEHOLDERS,
    // So the page can say which env vars are filling in for anything
    // not saved here yet.
    envFallback: {
      gmailUser: !!process.env.GMAIL_USER,
      gmailAppPassword: !!process.env.GMAIL_APP_PASSWORD,
      googleServiceAccountEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      googleServiceAccountPrivateKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      astroLeadsSpreadsheetId: !!process.env.ASTRO_LEADS_SPREADSHEET_ID,
      interaktApiKey: !!process.env.INTERAKT_API_KEY,
      googlePlacesApiKey: !!process.env.GOOGLE_PLACES_API_KEY,
    },
  };
};

// Every field the Settings page ever masks as "•••• already set" — the
// only fields "reveal" is allowed to return. Checked against an allowlist
// (not "any field name the client sends") so this endpoint can never be
// used to read an arbitrary column off the AppSettings row.
const REVEALABLE_FIELDS = [
  "gmailAppPassword",
  "googleServiceAccountPrivateKey",
  "sheetsRelaySecret",
  "interaktApiKey",
  "interaktWebhookSecret",
  "googlePlacesApiKey",
];

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Returns one already-saved secret's real value on demand, for the
  // Settings page's "👁 Show" button — deliberately NOT sent as part of
  // the loader's normal payload (which only ever ships boolean "is this
  // set" flags), so a secret only ever crosses the wire when someone with
  // admin access to this page explicitly asks to see it.
  if (intent === "revealSecret") {
    const field = formData.get("field");
    if (!REVEALABLE_FIELDS.includes(field)) {
      return { intent, ok: false, field, error: "Unknown field" };
    }
    const row = await getRawAppSettingsRow(session.shop);
    return { intent, ok: true, field, value: (row && row[field]) || "" };
  }

  if (intent === "sendTestWhatsapp") {
    const phone = formData.get("testPhone")?.trim();
    if (!phone) return { intent, ok: false, error: "Enter a phone number first" };

    const settings = await getAppSettings(session.shop);
    // Sample data — not a real lead, just enough to exercise the exact
    // same code path (and template) a real submission would use.
    const sampleRecommendation = {
      life: { gem: "Blue Sapphire", collection: "blue-sapphire" },
      benefic: { gem: "Emerald", collection: "emerald" },
      lucky: { gem: "Pearl", collection: "pearls" },
    };
    const trackingId = crypto.randomUUID();
    const testData = { name: "Test", phone };
    const submittedOn = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    // Checked separately from the send itself (which also triggers this
    // internally) purely for diagnostic visibility — a silently-failing
    // best-effort step here is exactly what made "no leads showing in the
    // Google Sheet" so hard to pin down earlier; this avoids repeating
    // that with the Interakt API Campaign grouping.
    let campaignStatus;
    try {
      campaignStatus = (await getOrCreateInteraktCampaignId(session.shop, settings)).status;
    } catch (err) {
      campaignStatus = "threw: " + String((err && err.message) || err);
    }

    let status;
    try {
      status = await sendGemRecommendationWhatsApp(settings, testData, sampleRecommendation, trackingId, submittedOn, FALLBACK_LOGO_URL, session.shop);
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
    }
    return { intent, ok: status.startsWith("OK"), status, campaignStatus };
  }

  if (intent === "sendTestOrderWhatsapp") {
    const phone = formData.get("testOrderPhone")?.trim();
    if (!phone) return { intent, ok: false, error: "Enter a phone number first" };

    const settings = await getAppSettings(session.shop);
    let status;
    try {
      status = await sendOrderProcessingWhatsApp(settings, { phone, firstName: "Test", orderNumber: "1001", shop: session.shop });
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
    }
    return { intent, ok: status.startsWith("OK"), status };
  }

  if (intent === "sendTestWishlistWhatsapp") {
    const phone = formData.get("testWishlistPhone")?.trim();
    if (!phone) return { intent, ok: false, error: "Enter a phone number first" };

    const settings = await getAppSettings(session.shop);
    // Sample data — same reasoning as the gem-recommendation test above.
    const sampleProducts = [
      { handle: "ruby", title: "Ruby" },
      { handle: "blue-sapphire", title: "Blue Sapphire" },
    ];
    let status;
    try {
      status = await sendWishlistWhatsApp(settings, {
        phone,
        email: "test@example.com",
        products: sampleProducts,
        productHandles: sampleProducts.map((p) => p.handle),
        headerImageUrl: FALLBACK_LOGO_URL,
      });
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
    }
    return { intent, ok: status.startsWith("OK"), status };
  }

  // Blank secret fields mean "leave unchanged", not "clear" — merge with
  // whatever's already saved so re-saving the non-secret fields doesn't
  // accidentally wipe a previously-set password/key.
  const existing = await getRawAppSettingsRow(session.shop);
  const gmailAppPassword = formData.get("gmailAppPassword")?.trim() || existing?.gmailAppPassword || "";
  const googleServiceAccountPrivateKey =
    formData.get("googleServiceAccountPrivateKey")?.trim() || existing?.googleServiceAccountPrivateKey || "";
  const interaktApiKey = formData.get("interaktApiKey")?.trim() || existing?.interaktApiKey || "";
  const interaktWebhookSecret = formData.get("interaktWebhookSecret")?.trim() || existing?.interaktWebhookSecret || "";
  const sheetsRelaySecret = formData.get("sheetsRelaySecret")?.trim() || existing?.sheetsRelaySecret || "";
  const googlePlacesApiKey = formData.get("googlePlacesApiKey")?.trim() || existing?.googlePlacesApiKey || "";

  await saveAppSettings(session.shop, {
    gmailUser: formData.get("gmailUser")?.trim() || "",
    gmailAppPassword,
    googleServiceAccountEmail: formData.get("googleServiceAccountEmail")?.trim() || "",
    googleServiceAccountPrivateKey,
    astroLeadsSpreadsheetId: formData.get("astroLeadsSpreadsheetId")?.trim() || "",
    sheetsRelayUrl: formData.get("sheetsRelayUrl")?.trim() || "",
    sheetsRelaySecret,
    wishlistEmailIntervalHours: formData.get("wishlistEmailIntervalHours")?.trim() || "",
    interaktApiKey,
    interaktTemplateName: formData.get("interaktTemplateName")?.trim() || "",
    interaktOrderTemplateName: formData.get("interaktOrderTemplateName")?.trim() || "",
    interaktWishlistTemplateName: formData.get("interaktWishlistTemplateName")?.trim() || "",
    orderProcessingTriggerTag: formData.get("orderProcessingTriggerTag")?.trim() || "",
    orderProcessingEmailTemplate: formData.get("orderProcessingEmailTemplate")?.trim() || "",
    whatsappIntervalValue: formData.get("whatsappIntervalValue")?.trim() || "",
    whatsappIntervalUnit: formData.get("whatsappIntervalUnit")?.trim() || "",
    interaktWebhookSecret,
    googlePlacesApiKey,
  });

  return { intent: "save", ok: true };
};

// ok === true -> Connected (green) · false -> Failing (red) ·
// null -> Not connected (gray, neutral — usually just "not set up yet")
// "warn" -> Connected, with a caveat (amber). Same 4-state model as the
// Server page's checks, just rendered as a compact pill instead of a
// table row.
const STATUS_STYLE = {
  true: { bg: brand.successBg, border: brand.successLine, color: brand.success, label: "● Connected" },
  false: { bg: brand.dangerBg, border: brand.dangerLine, color: brand.danger, label: "● Failing" },
  warn: { bg: brand.warnBg, border: brand.warnLine, color: brand.warn, label: "● Connected (see note)" },
  none: { bg: brand.panel, border: brand.border, color: brand.muted, label: "○ Not connected" },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const key = status.ok === true ? "true" : status.ok === false ? "false" : status.ok === "warn" ? "warn" : "none";
  const s = STATUS_STYLE[key];
  return (
    <span
      title={status.detail}
      style={{ display: "inline-flex", alignItems: "center", fontSize: "12px", fontWeight: 600, padding: "4px 11px", borderRadius: "999px", background: s.bg, border: `1px solid ${s.border}`, color: s.color, whiteSpace: "nowrap" }}
    >
      {s.label}
    </span>
  );
}

// One visual "card" per external service — icon + title on the left,
// live connection badge on the right, so at a glance you can tell which
// services are actually working without reading a single field. Purely
// a layout wrapper; doesn't change any field behavior.
function ServiceCard({ icon, title, status, children }) {
  return (
    <Card padding="0" style={{ marginBottom: "16px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "14px 18px", background: brand.panel, borderBottom: `1px solid ${brand.divider}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {icon}
          <span style={{ fontSize: "14px", fontWeight: 700, color: brand.ink }}>{title}</span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ padding: "18px" }}>{children}</div>
    </Card>
  );
}

// One test result line under a template's Send Test button — same shape
// used by all three WhatsApp templates below.
function TestResult({ fetcherData, intent }) {
  if (fetcherData?.intent !== intent) return null;
  return (
    <p style={{ ...hintStyle, marginTop: "8px", color: fetcherData.ok ? brand.success : brand.danger }}>
      {fetcherData.status || fetcherData.error}
    </p>
  );
}

// Lighter-weight card for the three individual WhatsApp templates —
// visually one notch below a full ServiceCard (no connection badge of
// its own, since all three share the WhatsApp card's single Connected/
// Failing status above them), so three of these read as "one connection,
// three templates" instead of three more independent-looking services.
function NumberBadge({ n }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px", borderRadius: "50%", background: brand.accentTint, color: brand.accent, fontSize: "11px", fontWeight: 700 }}>
      {n}
    </span>
  );
}

function TemplateCard({ icon, title, children }) {
  return (
    <div style={{ background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "12px", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", fontWeight: 700, color: brand.ink, marginBottom: "10px" }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

// Long setup/explanation text collapsed behind a native <details> toggle
// instead of sitting open on the page permanently — the field(s) that
// actually need filling in stay visible; the "why"/"how" reference text
// only shows up for someone who wants it. `open` on first load only when
// the thing it explains isn't set up yet (isSet === false), since that's
// exactly when someone would need the instructions most.
function Explain({ summary, children, defaultOpen }) {
  return (
    <details open={defaultOpen || undefined} style={{ marginBottom: "14px" }}>
      <summary style={{ cursor: "pointer", fontSize: "12.5px", fontWeight: 500, color: brand.muted, userSelect: "none" }}>{summary}</summary>
      <div style={{ marginTop: "8px", fontSize: "13px", color: brand.body, lineHeight: 1.6 }}>{children}</div>
    </details>
  );
}

// Client-side copy of orderProcessingEmail.server.js's own
// renderOrderProcessingEmailTemplate() -- duplicated (not imported)
// because that file is a .server.js module: React Router strips
// server-only files from the client bundle entirely, so importing it
// here for a client-side live preview isn't possible. Kept in sync by
// hand; if the real substitution logic ever changes there, mirror the
// change here too. Sample values stand in for what a real order would
// actually provide, purely for previewing the HTML's layout.
const EMAIL_PREVIEW_SAMPLE_VALUES = {
  customer_first_name: "Suraj Kumar",
  order_number: "#1000031314",
  order_status_url: "https://onlynaturalgemstones.com/",
  shop_name: "Only Natural Gemstones",
  shop_url: "https://onlynaturalgemstones.com",
  shop_email: "info@onlynaturalgemstones.com",
  // Literal, not the imported FALLBACK_LOGO_URL constant -- that's
  // exported from a .server.js file, and this constant sits at module
  // scope where the client bundle can see it (not inside loader/action,
  // which React Router strips for the client) -- referencing a
  // server-only import from unprotected module scope broke a different
  // route's production build once already this session for exactly
  // this reason (see cron.order-processing-catchup.jsx's history).
  shop_logo_url: "https://onlynaturalgemstones.com/cdn/shop/files/ONG_logo_home.png",
};
function renderEmailPreview(templateHtml) {
  let html = templateHtml || "";
  for (const [key, value] of Object.entries(EMAIL_PREVIEW_SAMPLE_VALUES)) {
    html = html.split(`{{${key}}}`).join(value).split(`{{ ${key} }}`).join(value);
  }
  return html;
}

// A password-style field that also knows how to reveal its own current
// saved value on demand (the 👁 button) — used for every secret on this
// page (Gmail App Password, service account key, Interakt Secret Key,
// webhook secret, Sheets relay secret, Places API key). Only shows the
// button at all once something's actually saved (isSet) — nothing to
// reveal otherwise. Fetches the real value exactly once per click-to-show
// (cached in local state after that), and feeds it back up to the
// parent's controlled value via onChange so it's visible in the field
// itself, not just logged somewhere.
function SecretField({ id, label, fieldName, isSet, value, onChange, placeholder, multiline, envFallbackHint }) {
  const revealFetcher = useFetcher();
  const [visible, setVisible] = useState(false);
  const revealing = revealFetcher.state !== "idle";

  useEffect(() => {
    if (revealFetcher.data?.intent === "revealSecret" && revealFetcher.data.field === fieldName && revealFetcher.data.ok) {
      onChange(revealFetcher.data.value || "");
      setVisible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealFetcher.data]);

  const toggle = () => {
    if (visible) {
      setVisible(false);
      return;
    }
    if (value) {
      // Already have a real value loaded locally (revealed earlier, or
      // just typed a new one) — no need to fetch again.
      setVisible(true);
      return;
    }
    revealFetcher.submit({ intent: "revealSecret", field: fieldName }, { method: "POST" });
  };

  const eyeBtnStyle = { fontSize: "11.5px", padding: "4px 10px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: "#fff", cursor: "pointer", color: brand.body };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
        <label style={labelStyle} htmlFor={id}>
          {label} {isSet ? "(●●●● already set)" : "(not set yet)"}
        </label>
        {isSet && (
          <button type="button" onClick={toggle} disabled={revealing} style={eyeBtnStyle}>
            {revealing ? "Loading…" : visible ? "Hide" : "Show & verify"}
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          style={{ ...fieldStyle, minHeight: "90px", fontFamily: brand.mono, fontSize: "12px" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet && !visible ? "•••• already set ••••" : placeholder}
        />
      ) : (
        <input
          id={id}
          style={fieldStyle}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet && !visible ? "•••• •••• •••• ••••" : placeholder}
        />
      )}
      {!isSet && envFallbackHint && <p style={hintStyle}>{envFallbackHint}</p>}
    </>
  );
}

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  marginTop: "5px",
  marginBottom: "16px",
  border: `1px solid ${brand.border}`,
  borderRadius: "10px",
  fontSize: "13px",
  fontFamily: "inherit",
  color: brand.body,
  background: "#fff",
  boxSizing: "border-box",
};
const labelStyle = { fontWeight: 500, fontSize: "12.5px", color: brand.body };
const hintStyle = { fontSize: "12px", color: brand.muted, marginTop: "-12px", marginBottom: "16px" };

const primaryBtn = { padding: "10px 18px", borderRadius: "9px", border: "none", background: brand.accent, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" };
const secondaryBtn = { padding: "10px 18px", borderRadius: "9px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "13px", fontWeight: 500, cursor: "pointer" };

function GroupBanner({ children, tone = "neutral" }) {
  const styles =
    tone === "info"
      ? { background: brand.accentTint, borderColor: brand.accentLine, color: brand.heading }
      : { background: brand.panel, borderColor: brand.border, color: brand.body };
  return (
    <div style={{ borderRadius: "10px", padding: "10px 14px", margin: "24px 0 12px", fontSize: "12.5px", fontWeight: 500, border: "1px solid transparent", ...styles }}>{children}</div>
  );
}

export default function SettingsPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const testOrderFetcher = useFetcher();
  const testWishlistFetcher = useFetcher();
  const toast = useToast();
  const isSaving = fetcher.state === "submitting";
  const isSendingTest = testFetcher.state !== "idle";
  const isSendingOrderTest = testOrderFetcher.state !== "idle";
  const isSendingWishlistTest = testWishlistFetcher.state !== "idle";

  const [gmailUser, setGmailUser] = useState(data.gmailUser);
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [gsaEmail, setGsaEmail] = useState(data.googleServiceAccountEmail);
  const [gsaKey, setGsaKey] = useState("");
  const [sheetId, setSheetId] = useState(data.astroLeadsSpreadsheetId);
  const [sheetsRelayUrl, setSheetsRelayUrl] = useState(data.sheetsRelayUrl);
  const [sheetsRelaySecret, setSheetsRelaySecret] = useState("");
  const [wishlistInterval, setWishlistInterval] = useState(data.wishlistEmailIntervalHours);
  const [interaktApiKey, setInteraktApiKey] = useState("");
  const [interaktTemplateName, setInteraktTemplateName] = useState(data.interaktTemplateName);
  const [interaktOrderTemplateName, setInteraktOrderTemplateName] = useState(data.interaktOrderTemplateName);
  const [orderProcessingTriggerTag, setOrderProcessingTriggerTag] = useState(data.orderProcessingTriggerTag);
  // Empty string ("using the built-in default") is shown as the actual
  // default HTML in the textarea, not a blank box -- otherwise "edit
  // the template" would mean starting from nothing instead of starting
  // from what's really sending today.
  const [orderProcessingEmailTemplate, setOrderProcessingEmailTemplate] = useState(
    data.orderProcessingEmailTemplate || data.defaultOrderProcessingEmailTemplate
  );
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [interaktWishlistTemplateName, setInteraktWishlistTemplateName] = useState(data.interaktWishlistTemplateName);
  const [testPhone, setTestPhone] = useState("");
  const [testOrderPhone, setTestOrderPhone] = useState("");
  const [testWishlistPhone, setTestWishlistPhone] = useState("");
  const [whatsappIntervalValue, setWhatsappIntervalValue] = useState(data.whatsappIntervalValue);
  const [whatsappIntervalUnit, setWhatsappIntervalUnit] = useState(data.whatsappIntervalUnit);
  const [interaktWebhookSecret, setInteraktWebhookSecret] = useState("");
  const [googlePlacesApiKey, setGooglePlacesApiKey] = useState("");

  useEffect(() => {
    if (fetcher.data?.intent === "save" && fetcher.data.ok) {
      toast.show("Settings saved");
      setGmailAppPassword("");
      setGsaKey("");
      setInteraktApiKey("");
      setInteraktWebhookSecret("");
      setSheetsRelaySecret("");
      setGooglePlacesApiKey("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  useEffect(() => {
    if (testFetcher.data?.intent === "sendTestWhatsapp") {
      toast.show(testFetcher.data.status || (testFetcher.data.ok ? "Sent" : "Failed"), { isError: !testFetcher.data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testFetcher.data]);

  useEffect(() => {
    if (testOrderFetcher.data?.intent === "sendTestOrderWhatsapp") {
      toast.show(testOrderFetcher.data.status || (testOrderFetcher.data.ok ? "Sent" : "Failed"), { isError: !testOrderFetcher.data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testOrderFetcher.data]);

  useEffect(() => {
    if (testWishlistFetcher.data?.intent === "sendTestWishlistWhatsapp") {
      toast.show(testWishlistFetcher.data.status || (testWishlistFetcher.data.ok ? "Sent" : "Failed"), { isError: !testWishlistFetcher.data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testWishlistFetcher.data]);

  const sendTestOrderWhatsapp = () => {
    testOrderFetcher.submit({ intent: "sendTestOrderWhatsapp", testOrderPhone }, { method: "POST" });
  };

  const sendTestWishlistWhatsapp = () => {
    testWishlistFetcher.submit({ intent: "sendTestWishlistWhatsapp", testWishlistPhone }, { method: "POST" });
  };

  const sendTestWhatsapp = () => {
    testFetcher.submit({ intent: "sendTestWhatsapp", testPhone }, { method: "POST" });
  };

  const submit = (e) => {
    e.preventDefault();
    fetcher.submit(
      {
        gmailUser,
        gmailAppPassword,
        googleServiceAccountEmail: gsaEmail,
        googleServiceAccountPrivateKey: gsaKey,
        astroLeadsSpreadsheetId: sheetId,
        sheetsRelayUrl,
        sheetsRelaySecret,
        wishlistEmailIntervalHours: wishlistInterval,
        interaktApiKey,
        interaktTemplateName,
        interaktOrderTemplateName,
        orderProcessingTriggerTag,
        // Submitting "" (not the literal default HTML) whenever the
        // textarea still matches the built-in default -- otherwise
        // saving this form for ANY unrelated reason (e.g. just updating
        // the Gmail password) would silently freeze today's default
        // into the database as a permanent "customization" the user
        // never asked for, and a future improvement to the built-in
        // default would then never reach this shop again.
        //
        // Normalizing \r\n -> \n on BOTH sides before comparing is not
        // optional -- confirmed live that a plain strict === comparison
        // fails here even when nothing was actually edited: browsers
        // normalize a <textarea>'s line endings to \r\n internally the
        // moment it's interacted with at all (even just focusing and
        // blurring it, no typing), while the server-rendered default
        // string keeps whatever the source file's own line endings
        // happen to be.
        orderProcessingEmailTemplate:
          orderProcessingEmailTemplate.replace(/\r\n/g, "\n") === data.defaultOrderProcessingEmailTemplate.replace(/\r\n/g, "\n")
            ? ""
            : orderProcessingEmailTemplate,
        interaktWishlistTemplateName,
        whatsappIntervalValue,
        whatsappIntervalUnit,
        interaktWebhookSecret,
        googlePlacesApiKey,
      },
      { method: "POST" }
    );
  };

  return (
    <PageIn>
      <PageHeader title="Settings" description="Connect and manage every external service this app uses." />

      <Card style={{ marginBottom: "20px" }}>
        <p style={{ fontSize: "13px", color: brand.body, margin: "0 0 10px" }}>
          Live status, checked just now — the same checks the <a href="/app/server-health" style={{ color: brand.accent }}>Server</a> page runs. Reload
          this page any time to re-check.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 12px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px" }}>
            <Icon name="mail" size={14} color={brand.accent} /> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Gmail</span> <StatusBadge status={data.serviceStatus.gmail} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 12px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px" }}>
            <Icon name="message" size={14} color={brand.success} /> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>WhatsApp</span> <StatusBadge status={data.serviceStatus.interakt} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 12px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px" }}>
            <Icon name="sheet" size={14} color={brand.success} /> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Google Sheets</span> <StatusBadge status={data.serviceStatus.sheets} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 12px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px" }}>
            <Icon name="pin" size={14} color={brand.danger} /> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Google Places</span> <StatusBadge status={data.serviceStatus.places} />
          </div>
        </div>
      </Card>

      <form onSubmit={submit}>
        <GroupBanner tone="info">⏱️ Message behavior — safe to change any time</GroupBanner>

        <Card style={{ marginBottom: "16px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 10px", color: brand.ink }}>Wishlist email timing</h2>
          <Explain summary="ℹ️ How this timing works">
            Hours to wait after a customer's <strong>last</strong> wishlist change before emailing them — each new
            change pushes this out again, so someone actively adding items all day gets one email once they've gone
            quiet, not one per add. See the <a href="/app/wishlist-leads" style={{ color: brand.accent }}>Wishlist Leads</a> page's
            "Send Due Emails Now" button to run a check immediately instead of waiting.
          </Explain>
          <label style={labelStyle} htmlFor="wishlistInterval">Wait time (hours)</label>
          <input id="wishlistInterval" style={{ ...fieldStyle, maxWidth: "120px" }} type="number" min="0" step="0.5" value={wishlistInterval} onChange={(e) => setWishlistInterval(e.target.value)} />
        </Card>

        <GroupBanner>🔑 Connect your accounts — one-time technical setup</GroupBanner>

        <ServiceCard icon={<Icon name="message" size={19} color={brand.success} />} title="WhatsApp (Interakt)" status={data.serviceStatus.interakt}>
          <SecretField
            id="interaktApiKey"
            label="Secret Key"
            fieldName="interaktApiKey"
            isSet={data.interaktApiKeySet}
            value={interaktApiKey}
            onChange={setInteraktApiKey}
            placeholder="from Interakt → Settings → Developer Setting"
            envFallbackHint={data.envFallback.interaktApiKey ? "Currently falling back to the INTERAKT_API_KEY env var on Render." : null}
          />

          <Explain summary="ℹ️ Every template below needs Meta approval first">
            One Interakt account powers all three templates below. Each needs its own template created and{" "}
            <strong>Meta-approved</strong> in Interakt (green dot, Catalog &amp; Templates → Templates Library)
            before it'll actually send.
          </Explain>

          {testFetcher.data?.campaignStatus && (
            <p style={{ ...hintStyle, marginTop: "-4px", color: testFetcher.data.campaignStatus.startsWith("OK") ? brand.success : brand.danger }}>
              API Campaign: {testFetcher.data.campaignStatus}
            </p>
          )}
        </ServiceCard>

        <GroupBanner>💬 Message templates — one card per WhatsApp message</GroupBanner>

        <div style={{ display: "grid", gap: "14px", marginBottom: "16px" }}>
          <TemplateCard icon={<NumberBadge n={1} />} title="Gem Recommendation">
            <label style={labelStyle} htmlFor="interaktTemplateName">Template name</label>
            <input
              id="interaktTemplateName"
              style={fieldStyle}
              type="text"
              value={interaktTemplateName}
              onChange={(e) => setInteraktTemplateName(e.target.value)}
              placeholder={`${data.defaultInteraktTemplateName} (default if left blank)`}
            />
            <label style={labelStyle} htmlFor="testPhone">Send test message</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "5px" }}>
              <input id="testPhone" style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }} type="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="9876543210 or +919876543210" />
              <button type="button" onClick={sendTestWhatsapp} disabled={isSendingTest} style={{ ...secondaryBtn, padding: "9px 16px", fontSize: "12.5px" }}>
                {isSendingTest ? "Sending…" : "Send Test"}
              </button>
            </div>
            <TestResult fetcherData={testFetcher.data} intent="sendTestWhatsapp" />
          </TemplateCard>

          <TemplateCard icon={<NumberBadge n={2} />} title="Order Processing">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Sends once per order, the first time it's <strong>tagged</strong> with the trigger tag below.
            </p>
            <label style={labelStyle} htmlFor="orderProcessingTriggerTag">Trigger tag</label>
            <input
              id="orderProcessingTriggerTag"
              style={fieldStyle}
              type="text"
              value={orderProcessingTriggerTag}
              onChange={(e) => setOrderProcessingTriggerTag(e.target.value)}
              placeholder={`${data.defaultOrderProcessingTriggerTag} (default if left blank)`}
            />
            <label style={labelStyle} htmlFor="interaktOrderTemplateName">Template name</label>
            <input
              id="interaktOrderTemplateName"
              style={fieldStyle}
              type="text"
              value={interaktOrderTemplateName}
              onChange={(e) => setInteraktOrderTemplateName(e.target.value)}
              placeholder={`${data.defaultInteraktOrderTemplateName} (default if left blank)`}
            />
            <label style={labelStyle} htmlFor="testOrderPhone">Send test message</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "5px" }}>
              <input id="testOrderPhone" style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }} type="tel" value={testOrderPhone} onChange={(e) => setTestOrderPhone(e.target.value)} placeholder="9876543210 or +919876543210" />
              <button type="button" onClick={sendTestOrderWhatsapp} disabled={isSendingOrderTest} style={{ ...secondaryBtn, padding: "9px 16px", fontSize: "12.5px" }}>
                {isSendingOrderTest ? "Sending…" : "Send Test"}
              </button>
            </div>
            <TestResult fetcherData={testOrderFetcher.data} intent="sendTestOrderWhatsapp" />
          </TemplateCard>

          <TemplateCard icon={<Icon name="mail" size={15} color={brand.accent} />} title="Order Processing — Email">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Sends alongside the WhatsApp message above, to the same order. Edit the raw HTML below, or leave it
              as-is to keep using the built-in design.
            </p>
            <Explain summary="ℹ️ Available placeholders (substituted automatically when the email actually sends)">
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: brand.muted, lineHeight: 1.8 }}>
                {data.orderProcessingEmailPlaceholders.map((p) => (
                  <li key={p.token}>
                    <code style={{ background: brand.panel, padding: "1px 5px", borderRadius: "4px" }}>{`{{${p.token}}}`}</code> — {p.description}
                  </li>
                ))}
              </ul>
            </Explain>
            <textarea
              id="orderProcessingEmailTemplate"
              value={orderProcessingEmailTemplate}
              onChange={(e) => setOrderProcessingEmailTemplate(e.target.value)}
              spellCheck={false}
              style={{ ...fieldStyle, fontFamily: brand.mono, fontSize: "11.5px", lineHeight: 1.5, height: "260px", resize: "vertical", whiteSpace: "pre" }}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setShowEmailPreview((v) => !v)} style={{ ...primaryBtn, padding: "8px 16px", fontSize: "12.5px" }}>
                {showEmailPreview ? "Hide preview" : "Preview"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Reset to the built-in default template? This discards your current edits (not saved until you click Save settings).")) {
                    setOrderProcessingEmailTemplate(data.defaultOrderProcessingEmailTemplate);
                  }
                }}
                style={{ ...secondaryBtn, padding: "8px 16px", fontSize: "12.5px" }}
              >
                Reset to default
              </button>
            </div>
            {showEmailPreview && (
              <div style={{ marginTop: "10px", border: `1px solid ${brand.border}`, borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ padding: "6px 10px", background: brand.panel, borderBottom: `1px solid ${brand.divider}`, fontSize: "11px", color: brand.muted }}>
                  Preview with sample data — this reflects what's in the box above right now, even if unsaved.
                </div>
                <iframe title="Order processing email preview" srcDoc={renderEmailPreview(orderProcessingEmailTemplate)} style={{ width: "100%", height: "500px", border: "none", display: "block" }} />
              </div>
            )}
          </TemplateCard>

          <TemplateCard icon={<NumberBadge n={3} />} title="Wishlist Reminder">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Sends alongside the wishlist reminder email, on the timing set below. Per-lead status on{" "}
              <a href="/app/wishlist-leads" style={{ color: brand.accent }}>Wishlist Leads</a>.
            </p>
            <label style={labelStyle} htmlFor="interaktWishlistTemplateName">Template name</label>
            <input
              id="interaktWishlistTemplateName"
              style={fieldStyle}
              type="text"
              value={interaktWishlistTemplateName}
              onChange={(e) => setInteraktWishlistTemplateName(e.target.value)}
              placeholder={`${data.defaultInteraktWishlistTemplateName} (default if left blank)`}
            />
            <label style={labelStyle} htmlFor="testWishlistPhone">Send test message</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "5px" }}>
              <input id="testWishlistPhone" style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }} type="tel" value={testWishlistPhone} onChange={(e) => setTestWishlistPhone(e.target.value)} placeholder="9876543210 or +919876543210" />
              <button type="button" onClick={sendTestWishlistWhatsapp} disabled={isSendingWishlistTest} style={{ ...secondaryBtn, padding: "9px 16px", fontSize: "12.5px" }}>
                {isSendingWishlistTest ? "Sending…" : "Send Test"}
              </button>
            </div>
            <TestResult fetcherData={testWishlistFetcher.data} intent="sendTestWishlistWhatsapp" />
          </TemplateCard>
        </div>

        <ServiceCard icon={<Icon name="gear" size={19} color={brand.muted} />} title="WhatsApp — advanced">
          <label style={labelStyle}>Follow-up reminder timing</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "5px" }}>
            <input style={{ ...fieldStyle, marginBottom: 0, maxWidth: "100px" }} type="number" min="0" step="1" value={whatsappIntervalValue} onChange={(e) => setWhatsappIntervalValue(e.target.value)} />
            <select style={{ ...fieldStyle, marginBottom: 0, width: "auto", padding: "9px 10px" }} value={whatsappIntervalUnit} onChange={(e) => setWhatsappIntervalUnit(e.target.value)}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          <Explain summary="ℹ️ How the follow-up reminder works">
            The first message always sends <strong>instantly</strong> on submission — this adds an optional SECOND
            message (same template, resent) after this much time. <strong>0</strong> turns follow-ups off. Needs an
            external scheduler hitting <code>/cron/whatsapp-queue?secret=…</code>, or use{" "}
            <a href="/app/astro-leads" style={{ color: brand.accent }}>Astro Leads</a>' "Process Follow-ups Now" button manually.
          </Explain>

          <label style={labelStyle}>Delivery/read tracking (webhook)</label>
          <SecretField
            id="interaktWebhookSecret"
            label="Webhook Secret"
            fieldName="interaktWebhookSecret"
            isSet={data.interaktWebhookSecretSet}
            value={interaktWebhookSecret}
            onChange={setInteraktWebhookSecret}
            placeholder="any secret string — pick one, match it in Interakt"
          />
          <Explain summary="ℹ️ Where to register the webhook URL">
            Interakt has no API to fetch campaign stats — register this URL in Interakt → Settings → Developer
            Setting → Webhooks (pick any secret, match it above) to see real sent/delivered/read status on{" "}
            <a href="/app/whatsapp-events" style={{ color: brand.accent }}>WhatsApp Events</a>:
            <br />
            <code>https://shubh-gems-customizer-app.onrender.com/public/interakt-webhook</code>
          </Explain>
        </ServiceCard>

        <ServiceCard icon={<Icon name="mail" size={19} color={brand.accent} />} title="Email sending (Gmail)" status={data.serviceStatus.gmail}>
          <Explain summary="ℹ️ What this is for">
            The account the gem-recommendation email sends from. Needs a Gmail App Password (Google account →
            Security → 2-Step Verification → App Passwords), not the account's real password.
          </Explain>

          <label style={labelStyle} htmlFor="gmailUser">Gmail address</label>
          <input id="gmailUser" style={fieldStyle} type="email" value={gmailUser} onChange={(e) => setGmailUser(e.target.value)} placeholder="info@onlynaturalgemstones.com" />

          <SecretField id="gmailAppPassword" label="App Password" fieldName="gmailAppPassword" isSet={data.gmailAppPasswordSet} value={gmailAppPassword} onChange={setGmailAppPassword} placeholder="16-character App Password" />
          {!data.gmailUser && data.envFallback.gmailUser && <p style={hintStyle}>Currently falling back to the GMAIL_USER env var on Render.</p>}
        </ServiceCard>

        <ServiceCard icon={<Icon name="sheet" size={19} color={brand.success} />} title="Google Sheets mirror (optional)" status={data.serviceStatus.sheets}>
          <Explain summary="ℹ️ What this is for, and which fields to use">
            Mirrors every lead/email-event row into a Google Sheet, in addition to this app's own database. Leave
            everything below blank to skip — nothing else depends on this.
            <br />
            <br />
            <strong>Sheets relay (recommended)</strong> — a tiny Apps Script Web App deployed inside your own Sheet
            under your own Google account. No service account or key needed at all, which is why this is the way to
            go if you ever hit a "service account key creation is disabled" error trying to set up the fields below.
            Ask for the <strong>sheets-relay.gs</strong> file and the 5-minute setup steps if you haven't deployed it
            yet. If a Relay URL is set here, it's used instead of the service-account fields below — no need to fill
            in both.
          </Explain>

          <label style={labelStyle} htmlFor="sheetsRelayUrl">Sheets relay URL</label>
          <input id="sheetsRelayUrl" style={fieldStyle} type="text" value={sheetsRelayUrl} onChange={(e) => setSheetsRelayUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />

          <SecretField id="sheetsRelaySecret" label="Sheets relay secret" fieldName="sheetsRelaySecret" isSet={data.sheetsRelaySecretSet} value={sheetsRelaySecret} onChange={setSheetsRelaySecret} placeholder="must match SHARED_SECRET in the script" />

          <label style={{ ...labelStyle, display: "block", marginTop: "6px", marginBottom: "4px" }}>Service account (fallback, only used if no relay URL is set above)</label>

          <label style={labelStyle} htmlFor="gsaEmail">Service account email</label>
          <input id="gsaEmail" style={fieldStyle} type="email" value={gsaEmail} onChange={(e) => setGsaEmail(e.target.value)} placeholder="xxxx@xxxx.iam.gserviceaccount.com" />

          <SecretField
            id="gsaKey"
            label="Service account private key"
            fieldName="googleServiceAccountPrivateKey"
            isSet={data.googleServiceAccountPrivateKeySet}
            value={gsaKey}
            onChange={setGsaKey}
            multiline
            placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
          />

          <label style={labelStyle} htmlFor="sheetId">Spreadsheet ID</label>
          <input id="sheetId" style={fieldStyle} type="text" value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="the long ID in the Sheet's URL" />
        </ServiceCard>

        <ServiceCard icon={<Icon name="pin" size={19} color={brand.danger} />} title="Location Autocomplete (Google Places)" status={data.serviceStatus.places}>
          <Explain summary="ℹ️ What this is for, and how to get a key">
            Powers the city suggestions on the storefront's "Place of Birth" field (Personalised Pooja form). The
            key is only ever used server-side by this app — the theme calls our own endpoint, never Google
            directly, so the key never reaches the customer's browser. Leave blank to keep using the free
            (Photon/OpenStreetMap) lookup instead.
            <br />
            <br />
            Get a key from Google Cloud Console: enable the <strong>Places API</strong>, then create an API key
            under Credentials. Since this key is only called from our server, restricting it to this store's domain
            isn't necessary the way it would be for a client-side integration — an IP or API restriction in Google
            Cloud Console is still good practice, but optional.
          </Explain>

          <SecretField
            id="googlePlacesApiKey"
            label="Google Places API Key"
            fieldName="googlePlacesApiKey"
            isSet={data.googlePlacesApiKeySet}
            value={googlePlacesApiKey}
            onChange={setGooglePlacesApiKey}
            placeholder="from Google Cloud Console → Credentials"
            envFallbackHint={data.envFallback.googlePlacesApiKey ? "Currently falling back to the GOOGLE_PLACES_API_KEY env var on Render." : null}
          />
        </ServiceCard>

        <div style={{ margin: "24px 0" }}>
          <button type="submit" disabled={isSaving} style={{ ...primaryBtn, opacity: isSaving ? 0.7 : 1, cursor: isSaving ? "default" : "pointer" }}>
            {isSaving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>

      <Card>
        <h2 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 8px", color: brand.ink }}>Where this data goes</h2>
        <p style={{ fontSize: "13px", color: brand.body, margin: 0 }}>
          Leads and email open/click/sent events are viewable on the{" "}
          <a href="/app/astro-leads" style={{ color: brand.accent }}>Astro Leads</a> page.
        </p>
      </Card>
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
