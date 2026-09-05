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
import { useAppBridge } from "@shopify/app-bridge-react";
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
  true: { bg: "#ECFDF5", border: "#A7F3D0", color: "#16A34A", label: "● Connected" },
  false: { bg: "#FEF2F2", border: "#FECACA", color: "#DC2626", label: "● Failing" },
  warn: { bg: "#FFFBEB", border: "#FDE68A", color: "#B45309", label: "● Connected (see note)" },
  none: { bg: "#F9FAFB", border: "#E5E7EB", color: "#6B7280", label: "○ Not connected" },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const key = status.ok === true ? "true" : status.ok === false ? "false" : status.ok === "warn" ? "warn" : "none";
  const s = STATUS_STYLE[key];
  return (
    <span
      title={status.detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "11.5px",
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "999px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// One visual "card" per external service — icon + title on the left,
// live connection badge on the right, so at a glance you can tell which
// services are actually working without reading a single field. Purely
// a layout wrapper around each s-section below; doesn't change any
// field behavior.
function ServiceCard({ icon, title, status, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: "14px",
        marginBottom: "16px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          padding: "14px 18px",
          background: "#FAFAFA",
          borderBottom: "1px solid #EDEEF1",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px", lineHeight: 1 }}>{icon}</span>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{title}</span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ padding: "18px" }}>{children}</div>
    </div>
  );
}

// One test result line under a template's Send Test button — same shape
// used by all three WhatsApp templates below.
function TestResult({ fetcherData, intent }) {
  if (fetcherData?.intent !== intent) return null;
  return (
    <p style={{ ...hintStyle, marginTop: "8px", color: fetcherData.ok ? "#16A34A" : "#DC2626" }}>
      {fetcherData.status || fetcherData.error}
    </p>
  );
}

// Lighter-weight card for the three individual WhatsApp templates —
// visually one notch below a full ServiceCard (no connection badge of
// its own, since all three share the WhatsApp card's single Connected/
// Failing status above them), so three of these read as "one connection,
// three templates" instead of three more independent-looking services.
function TemplateCard({ icon, title, children }) {
  return (
    <div
      style={{
        background: "#F9FAFB",
        border: "1px solid #EDEEF1",
        borderRadius: "12px",
        padding: "14px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
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
      <summary
        style={{
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: 500,
          color: "#6B7280",
          userSelect: "none",
        }}
      >
        {summary}
      </summary>
      <div style={{ marginTop: "8px" }}>{children}</div>
    </details>
  );
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

  const eyeBtnStyle = {
    fontSize: "11px",
    padding: "3px 9px",
    borderRadius: "8px",
    border: "1px solid #E5E7EB",
    background: "#fff",
    cursor: "pointer",
    color: "#374151",
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
        <label style={labelStyle} htmlFor={id}>
          {label} {isSet ? "(●●●● already set)" : "(not set yet)"}
        </label>
        {isSet && (
          <button type="button" onClick={toggle} disabled={revealing} style={eyeBtnStyle}>
            {revealing ? "Loading…" : visible ? "🙈 Hide" : "👁 Show & verify"}
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          style={{ ...fieldStyle, minHeight: "90px", fontFamily: "monospace", fontSize: "12px" }}
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
  padding: "9px 11px",
  marginTop: "5px",
  marginBottom: "16px",
  border: "1px solid #E5E7EB",
  borderRadius: "10px",
  fontSize: "13px",
  fontFamily: "inherit",
  color: "#374151",
  background: "#fff",
  boxSizing: "border-box",
};
const labelStyle = { fontWeight: 500, fontSize: "12.5px", color: "#374151" };
const hintStyle = { fontSize: "11.5px", color: "#6B7280", marginTop: "-12px", marginBottom: "16px" };

export default function SettingsPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const testOrderFetcher = useFetcher();
  const testWishlistFetcher = useFetcher();
  const shopify = useAppBridge();
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
      shopify.toast.show("Settings saved");
      setGmailAppPassword("");
      setGsaKey("");
      setInteraktApiKey("");
      setInteraktWebhookSecret("");
      setSheetsRelaySecret("");
      setGooglePlacesApiKey("");
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (testFetcher.data?.intent === "sendTestWhatsapp") {
      shopify.toast.show(testFetcher.data.status || (testFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !testFetcher.data.ok,
      });
    }
  }, [testFetcher.data, shopify]);

  useEffect(() => {
    if (testOrderFetcher.data?.intent === "sendTestOrderWhatsapp") {
      shopify.toast.show(testOrderFetcher.data.status || (testOrderFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !testOrderFetcher.data.ok,
      });
    }
  }, [testOrderFetcher.data, shopify]);

  useEffect(() => {
    if (testWishlistFetcher.data?.intent === "sendTestWishlistWhatsapp") {
      shopify.toast.show(testWishlistFetcher.data.status || (testWishlistFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !testWishlistFetcher.data.ok,
      });
    }
  }, [testWishlistFetcher.data, shopify]);

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
        interaktWishlistTemplateName,
        whatsappIntervalValue,
        whatsappIntervalUnit,
        interaktWebhookSecret,
        googlePlacesApiKey,
      },
      { method: "POST" }
    );
  };

  const groupBannerStyle = {
    borderRadius: "10px",
    padding: "10px 14px",
    margin: "24px 0 12px",
    fontSize: "12.5px",
    fontWeight: 500,
    border: "1px solid transparent",
  };

  return (
    <s-page heading="Astro Advice — Settings" width="full">
      <s-section heading="Connections at a glance">
        <s-paragraph>
          Live status, checked just now — the same checks the <s-link href="/app/server-health">Server</s-link> page
          runs. Reload this page any time to re-check.
        </s-paragraph>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <span>✉️</span> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Gmail</span> <StatusBadge status={data.serviceStatus.gmail} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <span>💬</span> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>WhatsApp</span> <StatusBadge status={data.serviceStatus.interakt} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <span>📊</span> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Google Sheets</span> <StatusBadge status={data.serviceStatus.sheets} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <span>📍</span> <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Google Places</span> <StatusBadge status={data.serviceStatus.places} />
          </div>
        </div>
      </s-section>

      <form onSubmit={submit}>
        <div style={{ ...groupBannerStyle, margin: "4px 0 12px", background: "#EFF4FF", borderColor: "#DBEAFE", color: "#1E3A8A" }}>
          ⏱️ Message behavior — safe to change any time
        </div>

        <s-section heading="Wishlist email timing">
          <Explain summary="ℹ️ How this timing works">
            <s-paragraph>
              Hours to wait after a customer's <s-text>last</s-text> wishlist change before emailing them — each new
              change pushes this out again, so someone actively adding items all day gets one email once they've
              gone quiet, not one per add. See the <s-link href="/app/wishlist-leads">Wishlist Leads</s-link> page's
              "Send Due Emails Now" button to run a check immediately instead of waiting.
            </s-paragraph>
          </Explain>
          <label style={labelStyle} htmlFor="wishlistInterval">Wait time (hours)</label>
          <input
            id="wishlistInterval"
            style={{ ...fieldStyle, maxWidth: "120px" }}
            type="number"
            min="0"
            step="0.5"
            value={wishlistInterval}
            onChange={(e) => setWishlistInterval(e.target.value)}
          />
        </s-section>

        <div style={{ ...groupBannerStyle, background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }}>
          🔑 Connect your accounts — one-time technical setup
        </div>

        <ServiceCard icon="💬" title="WhatsApp (Interakt)" status={data.serviceStatus.interakt}>
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
            <s-paragraph>
              One Interakt account powers all three templates below. Each needs its own template created and{" "}
              <s-text fontWeight="bold">Meta-approved</s-text> in Interakt (green dot, Catalog &amp; Templates →
              Templates Library) before it'll actually send.
            </s-paragraph>
          </Explain>

          {testFetcher.data?.campaignStatus && (
            <p
              style={{
                ...hintStyle,
                marginTop: "-4px",
                color: testFetcher.data.campaignStatus.startsWith("OK") ? "#16A34A" : "#DC2626",
              }}
            >
              API Campaign: {testFetcher.data.campaignStatus}
            </p>
          )}
        </ServiceCard>

        <div style={{ ...groupBannerStyle, margin: "0 0 12px", background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }}>
          💬 Message templates — one card per WhatsApp message
        </div>

        <div style={{ display: "grid", gap: "14px", marginBottom: "16px" }}>
          <TemplateCard icon="1️⃣" title="Gem Recommendation">
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
              <input
                id="testPhone"
                style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }}
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="9876543210 or +919876543210"
              />
              <s-button {...(isSendingTest ? { loading: true } : {})} onClick={sendTestWhatsapp}>
                Send Test
              </s-button>
            </div>
            <TestResult fetcherData={testFetcher.data} intent="sendTestWhatsapp" />
          </TemplateCard>

          <TemplateCard icon="2️⃣" title="Order Processing">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Sends once per order, the first time it's <s-text fontWeight="bold">tagged</s-text> with the trigger
              tag below.
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
              <input
                id="testOrderPhone"
                style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }}
                type="tel"
                value={testOrderPhone}
                onChange={(e) => setTestOrderPhone(e.target.value)}
                placeholder="9876543210 or +919876543210"
              />
              <s-button {...(isSendingOrderTest ? { loading: true } : {})} onClick={sendTestOrderWhatsapp}>
                Send Test
              </s-button>
            </div>
            <TestResult fetcherData={testOrderFetcher.data} intent="sendTestOrderWhatsapp" />
          </TemplateCard>

          <TemplateCard icon="3️⃣" title="Wishlist Reminder">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Sends alongside the wishlist reminder email, on the timing set below. Per-lead status on{" "}
              <s-link href="/app/wishlist-leads">Wishlist Leads</s-link>.
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
              <input
                id="testWishlistPhone"
                style={{ ...fieldStyle, marginBottom: 0, maxWidth: "220px" }}
                type="tel"
                value={testWishlistPhone}
                onChange={(e) => setTestWishlistPhone(e.target.value)}
                placeholder="9876543210 or +919876543210"
              />
              <s-button {...(isSendingWishlistTest ? { loading: true } : {})} onClick={sendTestWishlistWhatsapp}>
                Send Test
              </s-button>
            </div>
            <TestResult fetcherData={testWishlistFetcher.data} intent="sendTestWishlistWhatsapp" />
          </TemplateCard>
        </div>

        <ServiceCard icon="⚙️" title="WhatsApp — advanced">
          <label style={labelStyle}>Follow-up reminder timing</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "5px" }}>
            <input
              style={{ ...fieldStyle, marginBottom: 0, maxWidth: "100px" }}
              type="number"
              min="0"
              step="1"
              value={whatsappIntervalValue}
              onChange={(e) => setWhatsappIntervalValue(e.target.value)}
            />
            <select
              style={{ ...fieldStyle, marginBottom: 0, width: "auto", padding: "8px 10px" }}
              value={whatsappIntervalUnit}
              onChange={(e) => setWhatsappIntervalUnit(e.target.value)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
          <Explain summary="ℹ️ How the follow-up reminder works">
            <p style={hintStyle}>
              The first message always sends <s-text>instantly</s-text> on submission — this adds an optional SECOND
              message (same template, resent) after this much time. <s-text>0</s-text> turns follow-ups off. Needs
              an external scheduler hitting <s-text>/cron/whatsapp-queue?secret=…</s-text>, or use{" "}
              <s-link href="/app/astro-leads">Astro Leads</s-link>' "Process Follow-ups Now" button manually.
            </p>
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
            <p style={hintStyle}>
              Interakt has no API to fetch campaign stats — register this URL in Interakt → Settings → Developer
              Setting → Webhooks (pick any secret, match it above) to see real sent/delivered/read status on{" "}
              <s-link href="/app/whatsapp-events">WhatsApp Events</s-link>:
              <br />
              <s-text>https://shubh-gems-customizer-app.onrender.com/public/interakt-webhook</s-text>
            </p>
          </Explain>
        </ServiceCard>

        <ServiceCard icon="✉️" title="Email sending (Gmail)" status={data.serviceStatus.gmail}>
          <Explain summary="ℹ️ What this is for">
            <s-paragraph>
              The account the gem-recommendation email sends from. Needs a Gmail App Password (Google account →
              Security → 2-Step Verification → App Passwords), not the account's real password.
            </s-paragraph>
          </Explain>

          <label style={labelStyle} htmlFor="gmailUser">Gmail address</label>
          <input
            id="gmailUser"
            style={fieldStyle}
            type="email"
            value={gmailUser}
            onChange={(e) => setGmailUser(e.target.value)}
            placeholder="info@onlynaturalgemstones.com"
          />

          <SecretField
            id="gmailAppPassword"
            label="App Password"
            fieldName="gmailAppPassword"
            isSet={data.gmailAppPasswordSet}
            value={gmailAppPassword}
            onChange={setGmailAppPassword}
            placeholder="16-character App Password"
          />
          {!data.gmailUser && data.envFallback.gmailUser && (
            <p style={hintStyle}>Currently falling back to the GMAIL_USER env var on Render.</p>
          )}
        </ServiceCard>

        <ServiceCard icon="📊" title="Google Sheets mirror (optional)" status={data.serviceStatus.sheets}>
          <Explain summary="ℹ️ What this is for, and which fields to use">
            <s-paragraph>
              Mirrors every lead/email-event row into a Google Sheet, in addition to this app's own database. Leave
              everything below blank to skip — nothing else depends on this.
            </s-paragraph>
            <s-paragraph>
              <s-text fontWeight="bold">Sheets relay (recommended)</s-text> — a tiny Apps Script Web App deployed
              inside your own Sheet under your own Google account. No service account or key needed at all, which is
              why this is the way to go if you ever hit a "service account key creation is disabled" error trying to
              set up the fields below. Ask for the <s-text fontWeight="bold">sheets-relay.gs</s-text> file and the
              5-minute setup steps if you haven't deployed it yet. If a Relay URL is set here, it's used instead of
              the service-account fields below — no need to fill in both.
            </s-paragraph>
          </Explain>

          <label style={labelStyle} htmlFor="sheetsRelayUrl">Sheets relay URL</label>
          <input
            id="sheetsRelayUrl"
            style={fieldStyle}
            type="text"
            value={sheetsRelayUrl}
            onChange={(e) => setSheetsRelayUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
          />

          <SecretField
            id="sheetsRelaySecret"
            label="Sheets relay secret"
            fieldName="sheetsRelaySecret"
            isSet={data.sheetsRelaySecretSet}
            value={sheetsRelaySecret}
            onChange={setSheetsRelaySecret}
            placeholder="must match SHARED_SECRET in the script"
          />

          <label style={{ ...labelStyle, display: "block", marginTop: "6px", marginBottom: "4px" }}>
            Service account (fallback, only used if no relay URL is set above)
          </label>

          <label style={labelStyle} htmlFor="gsaEmail">Service account email</label>
          <input
            id="gsaEmail"
            style={fieldStyle}
            type="email"
            value={gsaEmail}
            onChange={(e) => setGsaEmail(e.target.value)}
            placeholder="xxxx@xxxx.iam.gserviceaccount.com"
          />

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
          <input
            id="sheetId"
            style={fieldStyle}
            type="text"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            placeholder="the long ID in the Sheet's URL"
          />
        </ServiceCard>

        <ServiceCard icon="📍" title="Location Autocomplete (Google Places)" status={data.serviceStatus.places}>
          <Explain summary="ℹ️ What this is for, and how to get a key">
            <s-paragraph>
              Powers the city suggestions on the storefront's "Place of Birth" field (Personalised Pooja form). The
              key is only ever used server-side by this app — the theme calls our own endpoint, never Google
              directly, so the key never reaches the customer's browser. Leave blank to keep using the free
              (Photon/OpenStreetMap) lookup instead.
            </s-paragraph>
            <s-paragraph>
              Get a key from Google Cloud Console: enable the <s-text fontWeight="bold">Places API</s-text>, then
              create an API key under Credentials. Since this key is only called from our server, restricting it to
              this store's domain isn't necessary the way it would be for a client-side integration — an IP or API
              restriction in Google Cloud Console is still good practice, but optional.
            </s-paragraph>
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
          <s-button {...(isSaving ? { loading: true } : {})} onClick={submit}>
            Save settings
          </s-button>
        </div>
      </form>

      <s-section slot="aside" heading="Where this data goes">
        <s-paragraph>
          Leads and email open/click/sent events are viewable on the{" "}
          <s-link href="/app/astro-leads">Astro Leads</s-link> page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
