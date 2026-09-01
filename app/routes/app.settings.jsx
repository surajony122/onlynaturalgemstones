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

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const row = await getRawAppSettingsRow(session.shop);
  return {
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

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

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
    <s-page heading="Astro Advice — Settings">
      <s-section heading="What's on this page">
        <s-paragraph>
          Controls how the gem-recommendation, order, and wishlist messages get sent — templates, timing, and the
          accounts they send through. <s-text fontWeight="bold">Message behavior</s-text> below is safe to change
          any time (template names, wait times, the order trigger tag). <s-text fontWeight="bold">Connect your
          accounts</s-text>, further down, is one-time technical setup (API keys, email credentials) — only change
          those if you know what you're updating them to.
        </s-paragraph>
      </s-section>

      <form onSubmit={submit}>
        <div style={{ ...groupBannerStyle, margin: "4px 0 12px", background: "#EFF4FF", borderColor: "#DBEAFE", color: "#1E3A8A" }}>
          💬 Message behavior — safe to change any time
        </div>

        <s-section heading="Wishlist email timing">
          <s-paragraph>
            Hours to wait after a customer's <s-text>last</s-text> wishlist change before emailing them — each new
            change pushes this out again, so someone actively adding items all day gets one email once they've gone
            quiet, not one per add. See the <s-link href="/app/wishlist-leads">Wishlist Leads</s-link> page's "Send
            Due Emails Now" button to run a check immediately instead of waiting.
          </s-paragraph>
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

        <s-section heading="Order Processing (Interakt)">
          <s-paragraph>
            Sends automatically the first time an order is TAGGED with the trigger tag below — add that tag to an
            order in Shopify Admin whenever you want the notification sent. (Not based on fulfillment status anymore
            — Shopify's own status fields turned out to be unreliable for this store's orders; a tag is explicit and
            fully in your control.) Requires a WhatsApp template named{" "}
            <s-text>{interaktOrderTemplateName || data.defaultInteraktOrderTemplateName}</s-text> to exist and be
            Meta-approved in Interakt. Sends at most once per order — later updates to the same order (e.g.
            shipping) don't repeat it, even if the tag stays on.
          </s-paragraph>

          <label style={labelStyle} htmlFor="orderProcessingTriggerTag">Trigger tag</label>
          <input
            id="orderProcessingTriggerTag"
            style={fieldStyle}
            type="text"
            value={orderProcessingTriggerTag}
            onChange={(e) => setOrderProcessingTriggerTag(e.target.value)}
            placeholder={`${data.defaultOrderProcessingTriggerTag} (default if left blank)`}
          />
          <p style={hintStyle}>
            Add this exact tag (case-insensitive) to an order's Tags field in Shopify Admin to trigger the message.
          </p>

          <label style={labelStyle} htmlFor="interaktOrderTemplateName">Template name</label>
          <input
            id="interaktOrderTemplateName"
            style={fieldStyle}
            type="text"
            value={interaktOrderTemplateName}
            onChange={(e) => setInteraktOrderTemplateName(e.target.value)}
            placeholder={`${data.defaultInteraktOrderTemplateName} (default if left blank)`}
          />

          <div style={{ marginTop: "8px", padding: "12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <label style={labelStyle} htmlFor="testOrderPhone">Send test WhatsApp message</label>
            <p style={{ ...hintStyle, marginTop: "4px" }}>
              Fires the real template (sample name "Test", order number "1001") — save your settings above first if
              you just entered the API key. Only works once the template shows a green "Approved" dot in Interakt.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            {testOrderFetcher.data?.intent === "sendTestOrderWhatsapp" && (
              <p style={{ ...hintStyle, marginTop: "8px", color: testOrderFetcher.data.ok ? "#16A34A" : "#DC2626" }}>
                {testOrderFetcher.data.status || testOrderFetcher.data.error}
              </p>
            )}
          </div>
        </s-section>

        <s-section heading="Wishlist Reminder (Interakt)">
          <s-paragraph>
            Sends alongside the wishlist reminder email — same debounced/interval timing (Settings above), not per
            wishlist-toggle. Requires a WhatsApp template named{" "}
            <s-text>{interaktWishlistTemplateName || data.defaultInteraktWishlistTemplateName}</s-text> to exist and
            be Meta-approved in Interakt. See <s-link href="/app/wishlist-leads">Wishlist Leads</s-link> for
            per-lead status and a manual retry button.
          </s-paragraph>

          <label style={labelStyle} htmlFor="interaktWishlistTemplateName">Template name</label>
          <input
            id="interaktWishlistTemplateName"
            style={fieldStyle}
            type="text"
            value={interaktWishlistTemplateName}
            onChange={(e) => setInteraktWishlistTemplateName(e.target.value)}
            placeholder={`${data.defaultInteraktWishlistTemplateName} (default if left blank)`}
          />

          <div style={{ marginTop: "8px", padding: "12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <label style={labelStyle} htmlFor="testWishlistPhone">Send test WhatsApp message</label>
            <p style={{ ...hintStyle, marginTop: "4px" }}>
              Fires the real template with two sample items (Ruby, Blue Sapphire) — save your settings above first
              if you just entered the API key. Only works once the template shows a green "Approved" dot in
              Interakt.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            {testWishlistFetcher.data?.intent === "sendTestWishlistWhatsapp" && (
              <p style={{ ...hintStyle, marginTop: "8px", color: testWishlistFetcher.data.ok ? "#16A34A" : "#DC2626" }}>
                {testWishlistFetcher.data.status || testWishlistFetcher.data.error}
              </p>
            )}
          </div>
        </s-section>

        <div style={{ ...groupBannerStyle, background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }}>
          🔑 Connect your accounts — one-time technical setup
        </div>

        <s-section heading="Email sending (Gmail)">
          <s-paragraph>
            The account the gem-recommendation email sends from. Needs a Gmail App Password (Google account →
            Security → 2-Step Verification → App Passwords), not the account's real password.
          </s-paragraph>

          <label style={labelStyle} htmlFor="gmailUser">Gmail address</label>
          <input
            id="gmailUser"
            style={fieldStyle}
            type="email"
            value={gmailUser}
            onChange={(e) => setGmailUser(e.target.value)}
            placeholder="info@onlynaturalgemstones.com"
          />

          <label style={labelStyle} htmlFor="gmailAppPassword">
            App Password{" "}
            {data.gmailAppPasswordSet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <input
            id="gmailAppPassword"
            style={fieldStyle}
            type="password"
            autoComplete="new-password"
            value={gmailAppPassword}
            onChange={(e) => setGmailAppPassword(e.target.value)}
            placeholder={data.gmailAppPasswordSet ? "•••• •••• •••• ••••" : "16-character App Password"}
          />
          {!data.gmailUser && data.envFallback.gmailUser && (
            <p style={hintStyle}>Currently falling back to the GMAIL_USER env var on Render.</p>
          )}
        </s-section>

        <s-section heading="Google Sheets mirror (optional)">
          <s-paragraph>
            Also mirrors every lead/email-event row into a Google Sheet, in addition to this app's own database.
            Leave blank to skip — nothing else depends on this.
          </s-paragraph>

          <s-paragraph>
            <s-text fontWeight="bold">Sheets relay (recommended)</s-text> — a tiny Apps Script Web App deployed
            inside your own Sheet under your own Google account. No service account or key needed at all, which is
            why this is the way to go if you ever hit a "service account key creation is disabled" error trying to
            set up the fields below. Ask for the <s-text fontWeight="bold">sheets-relay.gs</s-text> file and the
            5-minute setup steps if you haven't deployed it yet. If a Relay URL is set here, it's used instead of
            the service-account fields below — no need to fill in both.
          </s-paragraph>

          <label style={labelStyle} htmlFor="sheetsRelayUrl">Sheets relay URL</label>
          <input
            id="sheetsRelayUrl"
            style={fieldStyle}
            type="text"
            value={sheetsRelayUrl}
            onChange={(e) => setSheetsRelayUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
          />

          <label style={labelStyle} htmlFor="sheetsRelaySecret">
            Sheets relay secret{" "}
            {data.sheetsRelaySecretSet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <input
            id="sheetsRelaySecret"
            style={fieldStyle}
            type="password"
            autoComplete="new-password"
            value={sheetsRelaySecret}
            onChange={(e) => setSheetsRelaySecret(e.target.value)}
            placeholder={data.sheetsRelaySecretSet ? "•••• already set ••••" : "must match SHARED_SECRET in the script"}
          />

          <s-paragraph>
            <s-text fontWeight="bold">Service account (fallback, needs no relay set above)</s-text>
          </s-paragraph>

          <label style={labelStyle} htmlFor="gsaEmail">Service account email</label>
          <input
            id="gsaEmail"
            style={fieldStyle}
            type="email"
            value={gsaEmail}
            onChange={(e) => setGsaEmail(e.target.value)}
            placeholder="xxxx@xxxx.iam.gserviceaccount.com"
          />

          <label style={labelStyle} htmlFor="gsaKey">
            Service account private key{" "}
            {data.googleServiceAccountPrivateKeySet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <textarea
            id="gsaKey"
            style={{ ...fieldStyle, minHeight: "90px", fontFamily: "monospace", fontSize: "12px" }}
            value={gsaKey}
            onChange={(e) => setGsaKey(e.target.value)}
            placeholder={
              data.googleServiceAccountPrivateKeySet
                ? "•••• already set ••••"
                : "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
            }
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
        </s-section>

        <s-section heading="WhatsApp (Interakt)">
          <s-paragraph>
            Sends the gem-recommendation message directly via Interakt's Send Template API — our own backend
            decides who/when, same as the email. Requires a WhatsApp template named{" "}
            <s-text>{interaktTemplateName || data.defaultInteraktTemplateName}</s-text> to exist and be
            Meta-approved in Interakt first (Catalog &amp; Templates → Templates Library). Only sent when a lead has
            a phone number.
          </s-paragraph>

          <label style={labelStyle} htmlFor="interaktApiKey">
            Secret Key{" "}
            {data.interaktApiKeySet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <input
            id="interaktApiKey"
            style={fieldStyle}
            type="password"
            autoComplete="new-password"
            value={interaktApiKey}
            onChange={(e) => setInteraktApiKey(e.target.value)}
            placeholder={data.interaktApiKeySet ? "•••• •••• •••• ••••" : "from Interakt → Settings → Developer Setting"}
          />
          {!data.interaktApiKeySet && data.envFallback.interaktApiKey && (
            <p style={hintStyle}>Currently falling back to the INTERAKT_API_KEY env var on Render.</p>
          )}

          <label style={labelStyle} htmlFor="interaktTemplateName">Template name</label>
          <input
            id="interaktTemplateName"
            style={fieldStyle}
            type="text"
            value={interaktTemplateName}
            onChange={(e) => setInteraktTemplateName(e.target.value)}
            placeholder={`${data.defaultInteraktTemplateName} (default if left blank)`}
          />

          <div style={{ marginTop: "8px", padding: "12px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "10px" }}>
            <label style={labelStyle} htmlFor="testPhone">Send test WhatsApp message</label>
            <p style={{ ...hintStyle, marginTop: "4px" }}>
              Fires the real template (sample gem data) to this number via your saved Secret Key — save your
              settings above first if you just entered the key. Only works once the template shows a green
              "Approved" dot in Interakt.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            {testFetcher.data?.intent === "sendTestWhatsapp" && (
              <>
                <p style={{ ...hintStyle, marginTop: "8px", color: testFetcher.data.ok ? "#16A34A" : "#DC2626" }}>
                  Message: {testFetcher.data.status || testFetcher.data.error}
                </p>
                {testFetcher.data.campaignStatus && (
                  <p
                    style={{
                      ...hintStyle,
                      marginTop: "2px",
                      color: testFetcher.data.campaignStatus.startsWith("OK") ? "#16A34A" : "#DC2626",
                    }}
                  >
                    API Campaign: {testFetcher.data.campaignStatus}
                  </p>
                )}
              </>
            )}
          </div>

          <div style={{ marginTop: "12px" }}>
            <label style={labelStyle}>WhatsApp follow-up reminder</label>
            <p style={{ ...hintStyle, marginTop: "4px" }}>
              The first WhatsApp message always sends <s-text>instantly</s-text> the moment a lead submits — this
              setting adds an optional SECOND message (the same template, resent as a reminder) sent once this much
              time has passed since that first message, for any lead who has one. Set to <s-text>0</s-text> to turn
              the follow-up off entirely — only the instant first message will send. Requires an external scheduler
              pinging <s-text>/cron/whatsapp-queue?secret=…</s-text> at least as often as the delay below to send
              follow-ups automatically (same setup as the wishlist email cron) — the{" "}
              <s-link href="/app/astro-leads">Astro Leads</s-link> page also has a manual "Process Follow-ups Now"
              button that works regardless.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
          </div>

          <div style={{ marginTop: "12px" }}>
            <label style={labelStyle}>Delivery/read tracking (webhook)</label>
            <p style={{ ...hintStyle, marginTop: "4px" }}>
              Interakt has no API to fetch campaign stats — the only way to see real sent/delivered/read status in
              our own <s-link href="/app/whatsapp-events">WhatsApp Events</s-link> page is to receive their webhook.
              In Interakt → Settings → Developer Setting → Webhooks, register this URL and pick any secret (paste
              the same secret below — both sides must match):
              <br />
              <s-text>https://shubh-gems-customizer-app.onrender.com/public/interakt-webhook</s-text>
            </p>
            <label style={labelStyle} htmlFor="interaktWebhookSecret">
              Webhook Secret{" "}
              {data.interaktWebhookSecretSet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
            </label>
            <input
              id="interaktWebhookSecret"
              style={fieldStyle}
              type="password"
              autoComplete="new-password"
              value={interaktWebhookSecret}
              onChange={(e) => setInteraktWebhookSecret(e.target.value)}
              placeholder={data.interaktWebhookSecretSet ? "•••• •••• •••• ••••" : "any secret string — pick one, match it in Interakt"}
            />
          </div>
        </s-section>

        <s-section heading="Location Autocomplete (Google Places)">
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

          <label style={labelStyle} htmlFor="googlePlacesApiKey">
            Google Places API Key{" "}
            {data.googlePlacesApiKeySet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <input
            id="googlePlacesApiKey"
            style={fieldStyle}
            type="password"
            autoComplete="new-password"
            value={googlePlacesApiKey}
            onChange={(e) => setGooglePlacesApiKey(e.target.value)}
            placeholder={data.googlePlacesApiKeySet ? "•••• •••• •••• ••••" : "from Google Cloud Console → Credentials"}
          />
          {!data.googlePlacesApiKeySet && data.envFallback.googlePlacesApiKey && (
            <p style={hintStyle}>Currently falling back to the GOOGLE_PLACES_API_KEY env var on Render.</p>
          )}
        </s-section>

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
