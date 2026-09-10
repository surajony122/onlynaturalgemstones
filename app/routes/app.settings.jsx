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
  setInvoiceStartingNumber,
  saveInvoiceCollectionGstRates,
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
import { getOrderInvoiceTemplate, ORDER_INVOICE_PLACEHOLDERS, DEFAULT_INVOICE_NUMBER_PREFIX, getInvoiceEmailTemplate, ORDER_INVOICE_EMAIL_PLACEHOLDERS, fetchShopSellerInfo } from "../utils/orderInvoice.server";
import { brand, Icon, Card, PageHeader, PageIn } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const row = await getRawAppSettingsRow(session.shop);
  const settings = await getAppSettings(session.shop);

  // Real collections, for the GST-by-collection rate list below -- fetch
  // failing (e.g. a transient API hiccup) shouldn't take down the whole
  // Settings page, just leave that one list empty for this load.
  let collections = [];
  try {
    const collectionsRes = await admin.graphql(
      `#graphql
      query SettingsCollections { collections(first: 100) { nodes { id title } } }`,
    );
    const collectionsJson = await collectionsRes.json();
    collections = collectionsJson.data?.collections?.nodes || [];
  } catch (err) {
    console.error("[app.settings] failed to fetch collections:", err);
  }

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
    invoiceGstin: row?.invoiceGstin || "",
    invoiceSellerLegalName: row?.invoiceSellerLegalName || "",
    invoiceSellerAddress: row?.invoiceSellerAddress || "",
    invoiceSellerPhone: row?.invoiceSellerPhone || "",
    invoiceSellerEmail: row?.invoiceSellerEmail || "",
    invoiceSealImageUrl: row?.invoiceSealImageUrl || "",
    invoiceLogoImageUrl: row?.invoiceLogoImageUrl || "",
    invoiceSellerState: row?.invoiceSellerState || "",
    invoiceGstRateLoose: row?.invoiceGstRateLoose || "",
    invoiceGstRateCustomisation: row?.invoiceGstRateCustomisation || "",
    invoiceNumberPrefix: row?.invoiceNumberPrefix || "",
    defaultInvoiceNumberPrefix: DEFAULT_INVOICE_NUMBER_PREFIX,
    invoiceNextNumber: row?.invoiceNextNumber ?? null,
    invoiceDeliveryDays: row?.invoiceDeliveryDays || "",
    invoicePdfTemplate: row?.invoicePdfTemplate || "",
    defaultInvoicePdfTemplate: getOrderInvoiceTemplate({}),
    orderInvoicePlaceholders: ORDER_INVOICE_PLACEHOLDERS,
    invoiceEmailTemplate: row?.invoiceEmailTemplate || "",
    defaultInvoiceEmailTemplate: getInvoiceEmailTemplate({}),
    orderInvoiceEmailPlaceholders: ORDER_INVOICE_EMAIL_PLACEHOLDERS,
    collections,
    invoiceCollectionGstRates: row?.invoiceCollectionGstRates || {},
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
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Pre-fills the seller name/address/phone/state fields from the shop's
  // own Shopify Settings -> General/Shipping billing address, per
  // explicit request -- a merchant shouldn't have to retype what
  // Shopify already knows. Only pre-fills the FORM (client state); the
  // merchant still reviews and clicks Save themselves, same as any
  // other edit here -- nothing is written to AppSettings by this alone.
  // Deliberately does NOT touch GSTIN or seller email: GSTIN isn't
  // reliably exposed via the Admin API at all (see this file's own
  // header comment), and Shopify's shop.email is the store owner's
  // account email, not necessarily a public business contact address —
  // same reasoning astroAdvice.server.js's getShopFooterInfo already
  // uses for its own footer email.
  if (intent === "fetchShopSellerInfo") {
    try {
      const info = await fetchShopSellerInfo(admin);
      return { intent, ok: true, ...info };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

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

  if (intent === "setInvoiceStartingNumber") {
    const startNumber = formData.get("startNumber")?.trim();
    const result = await setInvoiceStartingNumber(session.shop, startNumber);
    return { intent, ok: result.ok, error: result.error };
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
    invoiceGstin: formData.get("invoiceGstin")?.trim() || "",
    invoiceSellerLegalName: formData.get("invoiceSellerLegalName")?.trim() || "",
    invoiceSellerAddress: formData.get("invoiceSellerAddress")?.trim() || "",
    invoiceSellerPhone: formData.get("invoiceSellerPhone")?.trim() || "",
    invoiceSellerEmail: formData.get("invoiceSellerEmail")?.trim() || "",
    invoiceSealImageUrl: formData.get("invoiceSealImageUrl")?.trim() || "",
    invoiceLogoImageUrl: formData.get("invoiceLogoImageUrl")?.trim() || "",
    invoiceSellerState: formData.get("invoiceSellerState")?.trim() || "",
    invoiceGstRateLoose: formData.get("invoiceGstRateLoose")?.trim() || "",
    invoiceGstRateCustomisation: formData.get("invoiceGstRateCustomisation")?.trim() || "",
    invoiceNumberPrefix: formData.get("invoiceNumberPrefix")?.trim() || "",
    invoiceDeliveryDays: formData.get("invoiceDeliveryDays")?.trim() || "",
    invoicePdfTemplate: formData.get("invoicePdfTemplate")?.trim() || "",
    invoiceEmailTemplate: formData.get("invoiceEmailTemplate")?.trim() || "",
  });

  // JSON, not a plain string -- saved via its own setter (see that
  // function's own comment for why this isn't in the generic FIELDS loop
  // above).
  const collectionRatesRaw = formData.get("invoiceCollectionGstRates");
  if (collectionRatesRaw) {
    try {
      await saveInvoiceCollectionGstRates(session.shop, JSON.parse(collectionRatesRaw));
    } catch (err) {
      console.error("[app.settings] failed to save invoiceCollectionGstRates:", err);
    }
  }

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

// Pick-a-design presets, per explicit request in place of the
// drag-and-drop builder ("too complicated ... give me 3 html options
// which predefine i can choose and edit html of it"). Each is a
// complete, ready-to-send template -- picking one loads it into the
// raw-HTML textarea below (replacing whatever's there, same confirm-
// before-discarding pattern as "Reset to default"), and it's then a
// completely normal hand-editable template from that point on.
//
// The PDF presets are 100% inline-styled (no <style> block, no CSS
// classes) -- see getDefaultOrderInvoiceTemplate's own comment in
// orderInvoice.server.js for exactly why that's required: pdfmake's
// HTML converter only ever reads an element's inline `style="..."`
// attribute, never a <style> block or a class selector, so anything
// styled via CSS classes looks right in this page's browser preview
// and silently disappears from the real PDF.
const PDF_TEMPLATE_PRESETS = [
  {
    id: "classic",
    label: "Classic",
    description: "Matches a traditional GST tax invoice layout — bordered boxes, shaded column headers.",
  },
  {
    id: "modern",
    label: "Modern Minimal",
    description: "Clean and light — no boxes, thin rule lines, generous white space.",
  },
  {
    id: "compact",
    label: "Compact",
    description: "Smaller type and tighter spacing — fits more line items on one page.",
  },
];

const EMAIL_TEMPLATE_PRESETS = [
  {
    id: "classic",
    label: "Classic",
    description: "Matches this store's other transactional emails — cream header band, WhatsApp/call/email footer.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Plain white background, simple centered message and button, no colored bands.",
  },
  {
    id: "bold",
    label: "Bold",
    description: "A solid-color header band and a larger call-to-action button.",
  },
];

// A small "choose a design" row: a dropdown of presets plus a button
// that loads the selected one -- used identically for both the PDF and
// the email tab, just pointed at a different preset list/setter.
// "classic" is identical to getDefaultOrderInvoiceTemplate() in
// orderInvoice.server.js (duplicated, not imported -- that's a
// .server.js module React Router strips from the client bundle, same
// reasoning already established for every other client-side preview
// copy on this page). "modern" and "compact" are genuinely different
// layouts, not just recolored -- all three stick to the same
// inline-styles-only rule for the same pdfmake reason.
function getPdfPresetHtml(id) {
  if (id === "modern") {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-size: 10px; color: #333;">

  <div style="text-align:center;margin-bottom:16px;">{{brand_header_html}}</div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tr>
      <td style="border:none;padding:0;font-size:16px;font-weight:600;color:#222;">Tax Invoice</td>
      <td style="border:none;padding:0;text-align:right;font-size:10px;color:#777;">{{invoice_number}}<br>{{invoice_date}}</td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr><td style="border:none;border-bottom:2px solid #d97b3f;padding:0;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr>
      <td style="border:none;width:38%;vertical-align:top;padding:0 10px 0 0;font-size:10px;line-height:1.7;">
        <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">From</div>
        <div style="font-weight:600;">{{seller_legal_name}}</div>
        {{seller_address}}<br>{{seller_phone}} · {{seller_email}}<br>GSTIN {{seller_gstin}}
      </td>
      <td style="border:none;width:38%;vertical-align:top;padding:0 10px;font-size:10px;line-height:1.7;">
        <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Bill To</div>
        <div style="font-weight:600;">{{customer_name}}</div>
        {{billing_address}}<br>{{customer_phone}}
      </td>
      <td style="border:none;width:24%;vertical-align:top;padding:0 0 0 10px;font-size:10px;line-height:1.7;">
        <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Shipment</div>
        Before {{delivery_before}}<br>{{delivery_mode}}<br>Sales: {{sales_person}}
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
    <tr>
      <th style="width:24%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">DESCRIPTION</th>
      <th style="width:8%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">HSN</th>
      <th style="width:6%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">QTY</th>
      <th style="width:13%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">RATE</th>
      <th style="width:12%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">CGST</th>
      <th style="width:12%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">SGST</th>
      <th style="width:12%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">IGST</th>
      <th style="width:13%;border:none;border-bottom:1.5px solid #222;padding:6px 6px;font-size:9px;text-align:left;color:#666;font-weight:600;">AMOUNT</th>
    </tr>
    {{line_items_rows}}
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
    <tr>
      <td style="border:none;width:55%;vertical-align:top;padding:0;font-size:9.5px;color:#666;">{{total_in_words}}<br>Payment: {{payment_mode}}</td>
      <td style="border:none;width:45%;vertical-align:top;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="border:none;font-size:10px;color:#666;padding:2px 0;">Subtotal</td><td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{subtotal}}</td></tr>
          <tr><td style="border:none;font-size:10px;color:#666;padding:2px 0;">GST</td><td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{total_gst}}</td></tr>
          <tr><td style="border:none;border-top:1.5px solid #222;font-size:13px;font-weight:700;padding:6px 0 0;">Total</td><td style="border:none;border-top:1.5px solid #222;font-size:13px;font-weight:700;padding:6px 0 0;text-align:right;">{{grand_total}}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div style="font-size:8px;color:#999;line-height:1.5;margin-bottom:20px;">
    The amount received against gemstone/jewellery is non-refundable. Customised jewellery is not eligible for return or money back. All disputes subject to Delhi jurisdiction.
  </div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="border:none;width:55%;padding:0;font-size:9.5px;color:#666;">Customer signature<br><br>{{customer_name}}</td>
      <td style="border:none;width:45%;padding:0;text-align:right;font-size:9.5px;color:#666;">For {{seller_legal_name}}<br>{{seal_html}}Authorised signatory</td>
    </tr>
  </table>

  <div style="text-align:center;font-size:8.5px;color:#aaa;margin-top:20px;">Computer generated invoice — {{shop_name}}</div>

</body>
</html>`;
  }
  if (id === "compact") {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-size: 8.5px; color: #222;">

  <div style="text-align:center;margin-bottom:6px;">{{brand_header_html}}</div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="border:1px solid #444;padding:4px 6px;font-size:9.5px;font-weight:bold;">INVOICE {{invoice_number}}</td>
      <td style="border:1px solid #444;padding:4px 6px;font-size:9.5px;font-weight:bold;text-align:right;">{{invoice_date}}</td>
    </tr>
    <tr>
      <td colspan="2" style="border:none;border-left:1px solid #444;border-right:1px solid #444;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;border-bottom:1px solid #444;width:34%;vertical-align:top;padding:4px 6px;font-size:8px;line-height:1.4;"><b>{{seller_legal_name}}</b><br>{{seller_address}}<br>{{seller_phone}}<br>GSTIN {{seller_gstin}}</td>
            <td style="border:none;border-bottom:1px solid #444;width:34%;vertical-align:top;padding:4px 6px;font-size:8px;line-height:1.4;"><b>{{customer_name}}</b><br>{{billing_address}}<br>{{customer_phone}}</td>
            <td style="border:none;border-bottom:1px solid #444;width:32%;vertical-align:top;padding:4px 6px;font-size:8px;line-height:1.4;">Before {{delivery_before}}<br>{{delivery_mode}}<br>{{sales_person}}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:none;border-left:1px solid #444;border-right:1px solid #444;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="width:24%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">ITEM</th>
            <th style="width:8%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">HSN</th>
            <th style="width:6%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">QTY</th>
            <th style="width:13%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">RATE</th>
            <th style="width:12%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">CGST</th>
            <th style="width:12%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">SGST</th>
            <th style="width:12%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">IGST</th>
            <th style="width:13%;background:#eee;border:1px solid #999;padding:3px 5px;font-size:7.5px;text-align:left;">AMT</th>
          </tr>
          {{line_items_rows}}
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:none;border-left:1px solid #444;border-right:1px solid #444;padding:4px 6px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;vertical-align:top;font-size:8px;">{{total_in_words}}<br>{{payment_mode}}</td>
            <td style="border:none;width:45%;vertical-align:top;">
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="border:none;font-size:8px;padding:1px 0;">Sub Total</td><td style="border:none;font-size:8px;padding:1px 0;text-align:right;">{{subtotal}}</td></tr>
                <tr><td style="border:none;font-size:8px;padding:1px 0;">GST</td><td style="border:none;font-size:8px;padding:1px 0;text-align:right;">{{total_gst}}</td></tr>
                <tr><td style="border:none;border-top:1px solid #444;font-size:9.5px;font-weight:bold;padding:2px 0;">Total</td><td style="border:none;border-top:1px solid #444;font-size:9.5px;font-weight:bold;padding:2px 0;text-align:right;">{{grand_total}}</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:none;border-top:1px solid #444;border-left:1px solid #444;border-right:1px solid #444;padding:4px 6px;font-size:6.5px;color:#666;line-height:1.35;">
        Amount received against gemstone/jewellery is non-refundable. Customised jewellery is not eligible for return. Disputes subject to Delhi jurisdiction.
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:none;border-top:1px solid #444;border-left:1px solid #444;border-right:1px solid #444;padding:6px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;font-size:8px;">Customer Signature: {{customer_name}}</td>
            <td style="border:none;width:45%;font-size:8px;text-align:right;">For {{seller_legal_name}}<br>{{seal_html}}Auth. Signatory</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:1px solid #444;padding:4px;text-align:center;font-size:7px;color:#888;">Computer generated invoice — {{shop_name}}</td>
    </tr>
  </table>

</body>
</html>`;
  }
  // "classic" (default) -- byte-for-byte the same as
  // getDefaultOrderInvoiceTemplate() in orderInvoice.server.js.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-size: 10px; color: #222;">

  <div style="text-align:center;margin-bottom:10px;">{{brand_header_html}}</div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="border:none;border-top:1px solid #333;border-left:1px solid #333;border-right:1px solid #333;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;border-bottom:1px solid #333;padding:8px 10px;font-size:12px;font-weight:bold;">TAX INVOICE # {{invoice_number}}</td>
            <td style="border:none;border-bottom:1px solid #333;padding:8px 10px;font-size:12px;font-weight:bold;text-align:right;">Date : {{invoice_date}}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="border:none;border-left:1px solid #333;border-right:1px solid #333;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;border-bottom:1px solid #333;width:38%;vertical-align:top;padding:8px 10px;font-size:10px;line-height:1.6;">
              <div style="font-weight:bold;margin-bottom:3px;">{{seller_legal_name}}</div>
              {{seller_address}}<br>
              Tel : {{seller_phone}}<br>
              Email : {{seller_email}}<br>
              GSTIN : {{seller_gstin}}
            </td>
            <td style="border:none;border-bottom:1px solid #333;width:38%;vertical-align:top;padding:8px 10px;font-size:10px;line-height:1.6;">
              <div style="font-weight:bold;margin-bottom:3px;">Customer Details</div>
              {{customer_name}}<br>
              {{billing_address}}<br>
              Tel : {{customer_phone}}
            </td>
            <td style="border:none;border-bottom:1px solid #333;width:24%;vertical-align:top;padding:8px 10px;font-size:10px;line-height:1.6;">
              Delivery Before : {{delivery_before}}<br>
              Sales Person : {{sales_person}}<br>
              Delivery Mode : {{delivery_mode}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="border:none;border-left:1px solid #333;border-right:1px solid #333;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="width:24%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">ITEM(s) DESCRIPTION</th>
            <th style="width:8%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">HSN</th>
            <th style="width:6%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">Qty</th>
            <th style="width:13%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">RATE (₹)</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">CGST</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">SGST</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">IGST</th>
            <th style="width:13%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">AMOUNT (₹)</th>
          </tr>
          {{line_items_rows}}
        </table>
      </td>
    </tr>
    <tr>
      <td style="border:none;border-left:1px solid #333;border-right:1px solid #333;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;vertical-align:top;padding:10px;font-size:10px;">
              Total In Words<br>
              <b>{{total_in_words}}</b><br><br>
              Payment Mode : {{payment_mode}}
            </td>
            <td style="border:none;width:45%;vertical-align:top;padding:10px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="border:none;font-size:10px;padding:2px 0;">Sub Total</td>
                  <td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{subtotal}}</td>
                </tr>
                <tr>
                  <td style="border:none;font-size:10px;padding:2px 0;">Total GST</td>
                  <td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{total_gst}}</td>
                </tr>
                <tr>
                  <td style="border:none;border-top:1px solid #333;font-size:12px;font-weight:bold;padding:4px 0;">Total</td>
                  <td style="border:none;border-top:1px solid #333;font-size:12px;font-weight:bold;padding:4px 0;text-align:right;">{{grand_total}}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="border:none;border-top:1px solid #333;border-left:1px solid #333;border-right:1px solid #333;font-size:8.5px;color:#555;line-height:1.5;padding:10px;">
        The Amount Received against Gemstone / Jewellery is Non-refundable. In case of any defect related to Gemstones / Jewellery, the Customer has to return the goods within 3 days after
        purchase. We take full responsibility if the sold gemstone is synthetic (man-made) and the full amount will be refunded. We take no responsibility if the Gemstone / Jewellery gets damaged in
        any way after it is delivered to the Client. Customised Jewellery — including personalised / engraved products manufactured to specific customer instructions — is not eligible for return /
        money back. Any item showing signs of wear, or that has been engraved, altered, resized or otherwise damaged, will not be accepted for return. All matters / disputes subject to Delhi
        Jurisdiction.
      </td>
    </tr>
    <tr>
      <td style="border:none;border-top:1px solid #333;border-left:1px solid #333;border-right:1px solid #333;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;padding:14px 10px;vertical-align:top;">
              I have read, understood and agreed to the terms &amp; conditions.<br><br>
              Customer Signature : {{customer_name}}
            </td>
            <td style="border:none;width:45%;padding:14px 10px;vertical-align:top;text-align:right;">
              For {{seller_legal_name}}<br>
              {{seal_html}}
              Authorised Seal &amp; Signatory
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #333;text-align:center;font-size:9px;color:#666;padding:8px;">This is a Computer Generated Invoice — {{shop_name}} ({{shop_url}})</td>
    </tr>
  </table>

</body>
</html>`;
}

// "classic" is identical to getDefaultInvoiceEmailTemplate() in
// orderInvoice.server.js (duplicated for the same client-bundle reason
// as above). Regular <style>-block CSS is fine for all three of these
// -- unlike the PDF, the email never goes through pdfmake, so a real
// email client (or nodemailer, which just sends the raw HTML as-is)
// applies a <style> block normally.
function getEmailPresetHtml(id) {
  if (id === "minimal") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width">
  <style type="text/css">
    body{margin:0;padding:0;width:100%;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333}
    table{border-spacing:0;border-collapse:collapse} img{border:0;display:block} a{text-decoration:none}
    .container{width:100%;max-width:480px;margin:0 auto;padding:40px 24px;text-align:center}
    .content{font-size:15px;line-height:1.7;color:#444;text-align:left;margin-top:24px}
    .button{display:inline-block;background:#222;color:#fff!important;text-decoration:none!important;padding:12px 26px;border-radius:4px;font-size:14px;margin-top:20px}
    .footer{font-size:12px;color:#999;margin-top:36px}
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table class="container" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="90" style="margin:0 auto;">
      <div class="content">
        <p>Hello {{customer_first_name}},</p>
        <p>Thank you for your order {{order_number}}. Your GST tax invoice {{invoice_number}} is attached to this email as a PDF.</p>
      </div>
      <a href="{{order_status_url}}" class="button">View Your Order</a>
      <div class="footer">{{shop_name}} · <a href="{{shop_url}}" style="color:#999;">{{shop_url}}</a></div>
    </td></tr></table>
  </td></tr></table>
</body>
</html>`;
  }
  if (id === "bold") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width">
  <style type="text/css">
    body{margin:0;padding:0;width:100%;background-color:#f3f2ef;font-family:Arial,Helvetica,sans-serif;color:#333}
    table{border-spacing:0;border-collapse:collapse} img{border:0;display:block} a{text-decoration:none}
    .wrapper{width:100%;background:#f3f2ef;padding:32px 0}
    .container{width:100%;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
    .header{background:#8c7a4e;padding:32px 20px;text-align:center}
    .header img{margin:0 auto}
    .content{padding:32px 28px;font-size:15px;line-height:1.7;color:#333}
    .button{display:block;width:100%;box-sizing:border-box;text-align:center;background:#8c7a4e;color:#fff!important;text-decoration:none!important;padding:14px;border-radius:6px;font-size:15px;font-weight:600;margin-top:20px}
    .footer{padding:20px;text-align:center;font-size:12px;color:#999;background:#faf9f7}
  </style>
</head>
<body>
  <table class="wrapper" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table class="container" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <div class="header"><img src="{{shop_logo_url}}" alt="{{shop_name}}" width="100"></div>
      <div class="content">
        <p>Hello {{customer_first_name}},</p>
        <p>Your order <b>{{order_number}}</b> is complete — invoice <b>{{invoice_number}}</b> is attached as a PDF.</p>
        <a href="{{order_status_url}}" class="button">View Your Order</a>
      </div>
      <div class="footer">{{shop_name}} · {{shop_url}}</div>
    </td></tr></table>
  </td></tr></table>
</body>
</html>`;
  }
  // "classic" (default) -- byte-for-byte the same as
  // getDefaultInvoiceEmailTemplate() in orderInvoice.server.js.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Your invoice is here</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width">
  <style type="text/css">
.gt a{color:#222!important;text-decoration:none!important}
body{margin:0;padding:0;width:100%;background-color:#f3f2ef;font-family:Arial,Helvetica,sans-serif;color:#4f5965}
table{border-spacing:0;border-collapse:collapse} img{border:0;display:block} a{text-decoration:none}
.email-wrapper{width:100%;background-color:#f3f2ef}.page-padding{padding:32px 0}
.email-container{width:500px;max-width:500px;background-color:#fff;border-radius:0 0 12px 12px;overflow:hidden}
.logo-section{padding:28px 20px 25px;text-align:center;background-color:#fffcf3;border-top:5px solid #8c7a4e}
.logo-section img{max-width:100px;width:auto;height:auto;margin:0 auto}
.logo-text{margin:0;font-size:30px;font-weight:normal;color:#a76642}
.divider-cell{padding-left:0;padding-right:0}.divider{height:1px;background-color:#d5d0c8;width:100%;font-size:1px;line-height:1px}
.content-section{padding:30px 28px 25px;font-size:15px;line-height:1.6;color:#4f5965;background-color:#fff}
.content-inner{width:100%;margin:0 auto}.content-section p{margin-top:0;margin-bottom:18px}
.order-number,.complete-status{font-weight:bold;color:#3d4652}
.button-table{width:100%;margin-top:20px;margin-bottom:10px}.button-cell{width:50%;vertical-align:middle}
.button-gap{width:8px;min-width:8px;font-size:1px;line-height:1px}
.email-button{display:block;width:100%;box-sizing:border-box;text-align:center;background-color:#8c7a4e;color:#fff!important;padding:11px 5px;font-size:14px;font-weight:500;line-height:16px;border-radius:3px;white-space:nowrap;text-decoration:none!important}
.secondary-button{background-color:#fff;color:#8c7a4e!important;border:1px solid #8c7a4e;padding:10px 5px}
.footer-section{padding:14px 18px 16px;text-align:center;color:#4f5965;background-color:#fffcf3}
.footer-title{margin:0 0 8px;font-size:14px;line-height:1.45;color:#4f5965}
.address{margin:0 0 10px;font-size:13px;line-height:1.45;color:#333!important}.address a{color:#333!important;text-decoration:none!important}
.contact-table{width:100%;margin:0 auto;table-layout:fixed}.website-row{padding-bottom:8px}
.contact-item{width:50%;padding:3px 2px;text-align:center;vertical-align:middle;font-size:13px;line-height:18px}
.single-contact-item{padding:3px 2px;text-align:center;vertical-align:middle;font-size:13px;line-height:18px}
.contact-link{color:#333!important;text-decoration:none!important;white-space:nowrap}
.contact-icon{width:18px;height:18px;display:block}
@media only screen and (max-width:600px){
.page-padding{padding:0!important}.email-container{width:100%!important;max-width:100%!important;border-radius:0!important}
.logo-section{padding:22px 15px!important}.logo-section img{max-width:100px!important}
.content-section{padding:24px 20px 18px!important;font-size:16px!important}
.button-table{width:100%!important;margin-top:18px!important;margin-bottom:10px!important}.button-gap{width:8px!important;min-width:8px!important}
.email-button{font-size:13px!important;line-height:16px!important;padding:10px 3px!important}.secondary-button{padding:9px 3px!important}
.footer-section{padding:12px 12px 14px!important}.footer-title{font-size:14px!important;line-height:1.4!important;margin-bottom:7px!important}
.address{font-size:13px!important;line-height:1.4!important;margin-bottom:8px!important}.website-row{padding-bottom:6px!important}
.contact-item,.single-contact-item{padding:3px 1px!important;font-size:13px!important}.contact-link{white-space:nowrap!important}
}
</style>
</head>


<body>

  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td class="page-padding" align="center">

        <table class="email-container" width="500" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td class="logo-section">
              <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="100">
            </td>
          </tr>

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td class="content-section">
              <div class="content-inner">

                <p>Hello {{customer_first_name}},</p>

                <p>
                  Thank you for your order
                  <span class="order-number">{{order_number}}</span>.
                  Your GST tax invoice
                  <span class="order-number">{{invoice_number}}</span>
                  is attached to this email as a PDF.
                </p>

                <p style="margin-top: 0; margin-bottom: 0;">
                  Best Wishes &amp; Regards!
                </p>

                <table class="button-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="button-cell" width="50%">
                      <a href="{{order_status_url}}" class="email-button">View Your Order</a>
                    </td>
                    <td class="button-gap" width="8">&nbsp;</td>
                    <td class="button-cell" width="50%">
                      <a href="{{shop_url}}" class="email-button secondary-button">Visit Our Store</a>
                    </td>
                  </tr>
                </table>

              </div>
            </td>
          </tr>

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td class="footer-section">

              <p class="footer-title">
                Thanks for choosing {{shop_name}} from the House of Shubh Gems.
              </p>

              <p class="address">
                <a href="https://maps.app.goo.gl/vffRkrDyMiM9q895A">
                  L-75-76, Lajpat Nagar 2, New Delhi - Delhi - 110024, India
                </a>
              </p>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="single-contact-item website-row" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/website.png?v=1788870868" alt="Website" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="{{shop_url}}" class="contact-link">onlynaturalgemstones.com</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <a href="https://wa.me/919310400152">
                            <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358" alt="WhatsApp" width="18" height="18" class="contact-icon">
                          </a>
                        </td>
                        <td valign="middle">
                          <a href="https://wa.me/919310400152" class="contact-link">+91-9310-400-152</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td class="contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346" alt="Call" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="tel:+918010555111" class="contact-link">+91-8010-555-111</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="single-contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Email.png?v=1788596216" alt="Email" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="mailto:{{shop_email}}" class="contact-link">{{shop_email}}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

function PresetPicker({ presets, getHtml, onApply }) {
  const [selected, setSelected] = useState(presets[0].id);
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px", padding: "10px 12px", background: brand.panel, borderRadius: "10px", border: `1px solid ${brand.border}` }}>
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: brand.body }}>Choose a design:</span>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: "7px 9px", borderRadius: "7px", border: `1px solid ${brand.border}`, fontSize: "12.5px" }}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <span style={{ fontSize: "11.5px", color: brand.muted, flex: 1, minWidth: "160px" }}>
        {presets.find((p) => p.id === selected)?.description}
      </span>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Load the "${presets.find((p) => p.id === selected)?.label}" design? This replaces the HTML below (not saved until you click Save settings).`)) {
            onApply(getHtml(selected));
          }
        }}
        style={{ padding: "7px 14px", borderRadius: "8px", border: "none", background: brand.accent, color: "#fff", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Use this design
      </button>
    </div>
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
// Same reasoning as EMAIL_PREVIEW_SAMPLE_VALUES/renderEmailPreview above
// -- a client-side-only duplicate of orderInvoice.server.js's own
// substitution, since that's a .server.js module React Router strips
// from the client bundle. Kept in sync by hand.
const INVOICE_PREVIEW_SAMPLE_VALUES = {
  // No <img> here on purpose -- an actual logo/seal is fetched and
  // inlined as base64 server-side at send time (see
  // fetchImageAsDataUri() in orderInvoice.server.js), which this
  // client-side-only preview can't reproduce -- it shows the same
  // text/blank fallback a real send would use with nothing configured.
  brand_header_html: '<span style="font-size:22px;font-weight:bold;color:#d97b3f;">Only Natural Gemstones</span>',
  seal_html: "<br><br>",
  invoice_number: "INV-000123",
  invoice_date: "10/09/2026",
  order_number: "#1000031314",
  customer_name: "Suraj Kumar",
  customer_email: "suraj@example.com",
  customer_phone: "09968034137",
  // No name/phone here -- the real send excludes them from this
  // placeholder too (customer_name/customer_phone print separately, see
  // formatAddress's includeName/includePhone flags).
  billing_address: "123 MG Road<br>Delhi, Delhi, 110024<br>India",
  shipping_address: "Suraj Kumar<br>123 MG Road<br>Delhi, Delhi, 110024<br>India",
  seller_legal_name: "Only Natural Gemstones",
  seller_address: "L-75-76, Lajpat Nagar 2<br>New Delhi, Delhi, 110024<br>India",
  seller_phone: "+91-8010-555-111",
  seller_email: "support@onlynaturalgemstones.com",
  seller_gstin: "07ABCDE1234F1Z5",
  sales_person: "Only Natural Gemstones",
  delivery_mode: "By Courier",
  delivery_before: "20/09/2026",
  payment_mode: "Razorpay",
  line_items_rows:
    '<tr><td>Blue Sapphire - 4.12 Carat</td><td>7103</td><td>1</td><td>&#8377;18,500.00</td>' +
    '<td>&#8377;277.50<br><span style="color:#888;font-size:9px;">(1.5%)</span></td>' +
    '<td>&#8377;277.50<br><span style="color:#888;font-size:9px;">(1.5%)</span></td>' +
    '<td>&#8377;0.00<br><span style="color:#888;font-size:9px;">(0%)</span></td>' +
    '<td>&#8377;19,055.00</td></tr>' +
    '<tr><td>Gemstone Customisation</td><td>7113</td><td>1</td><td>&#8377;2,150.00</td>' +
    '<td>&#8377;32.25<br><span style="color:#888;font-size:9px;">(1.5%)</span></td>' +
    '<td>&#8377;32.25<br><span style="color:#888;font-size:9px;">(1.5%)</span></td>' +
    '<td>&#8377;0.00<br><span style="color:#888;font-size:9px;">(0%)</span></td>' +
    '<td>&#8377;2,214.50</td></tr>',
  subtotal: "₹20,650.00",
  total_gst: "₹619.50",
  grand_total: "₹21,269.50",
  total_in_words: "Indian Rupee Twenty One Thousand Two Hundred Sixty Nine Only",
  tax_treatment_note: "",
  shop_name: "Only Natural Gemstones",
  shop_url: "https://onlynaturalgemstones.com",
};
function renderInvoicePreview(templateHtml) {
  let html = templateHtml || "";
  for (const [key, value] of Object.entries(INVOICE_PREVIEW_SAMPLE_VALUES)) {
    html = html.split(`{{${key}}}`).join(value).split(`{{ ${key} }}`).join(value);
  }
  return html;
}

// Same reasoning as INVOICE_PREVIEW_SAMPLE_VALUES above -- a client-side
// duplicate of orderInvoice.server.js's own invoice-EMAIL substitution
// (separate from the PDF's), since that's a .server.js module.
const INVOICE_EMAIL_PREVIEW_SAMPLE_VALUES = {
  customer_first_name: "Suraj",
  order_number: "#1000031314",
  invoice_number: "INV-000123",
  order_status_url: "https://onlynaturalgemstones.com/",
  shop_name: "Only Natural Gemstones",
  shop_url: "https://onlynaturalgemstones.com",
  shop_email: "info@onlynaturalgemstones.com",
  shop_logo_url: "https://onlynaturalgemstones.com/cdn/shop/files/ONG_logo_home.png",
};
function renderInvoiceEmailPreview(templateHtml) {
  let html = templateHtml || "";
  for (const [key, value] of Object.entries(INVOICE_EMAIL_PREVIEW_SAMPLE_VALUES)) {
    html = html.split(`{{${key}}}`).join(value).split(`{{ ${key} }}`).join(value);
  }
  return html;
}

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
  const [invoiceGstin, setInvoiceGstin] = useState(data.invoiceGstin);
  const [invoiceSellerLegalName, setInvoiceSellerLegalName] = useState(data.invoiceSellerLegalName);
  const [invoiceSellerAddress, setInvoiceSellerAddress] = useState(data.invoiceSellerAddress);
  const [invoiceSellerPhone, setInvoiceSellerPhone] = useState(data.invoiceSellerPhone);
  const [invoiceSellerEmail, setInvoiceSellerEmail] = useState(data.invoiceSellerEmail);
  const [invoiceSealImageUrl, setInvoiceSealImageUrl] = useState(data.invoiceSealImageUrl);
  const [invoiceLogoImageUrl, setInvoiceLogoImageUrl] = useState(data.invoiceLogoImageUrl);
  const [invoiceSellerState, setInvoiceSellerState] = useState(data.invoiceSellerState);
  const [invoiceGstRateLoose, setInvoiceGstRateLoose] = useState(data.invoiceGstRateLoose);
  const [invoiceGstRateCustomisation, setInvoiceGstRateCustomisation] = useState(data.invoiceGstRateCustomisation);
  const [invoiceNumberPrefix, setInvoiceNumberPrefix] = useState(data.invoiceNumberPrefix);
  const [invoiceDeliveryDays, setInvoiceDeliveryDays] = useState(data.invoiceDeliveryDays);
  const [invoicePdfTemplate, setInvoicePdfTemplate] = useState(data.invoicePdfTemplate || data.defaultInvoicePdfTemplate);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [invoiceEmailTemplate, setInvoiceEmailTemplate] = useState(data.invoiceEmailTemplate || data.defaultInvoiceEmailTemplate);
  const [showInvoiceEmailPreview, setShowInvoiceEmailPreview] = useState(false);
  // Which of the two GST Tax Invoice tabs is active -- "email" (the
  // message the customer receives) or "pdf" (the attached invoice
  // document's own layout), per explicit request to split these into
  // separate tabs rather than one long stacked section.
  const [invoiceTab, setInvoiceTab] = useState("email");
  const [collectionGstRates, setCollectionGstRates] = useState(data.invoiceCollectionGstRates || {});
  const setCollectionRate = (gid, value) => {
    setCollectionGstRates((prev) => ({ ...prev, [gid]: value }));
  };

  // "Fetch from Shopify" -- pre-fills legal name/address/phone/state from
  // the shop's own Shopify billing address (Settings -> General/
  // Shipping there). Only fills the FORM; nothing is saved to
  // AppSettings until the merchant reviews it and clicks the page's own
  // Save button, same as typing it in by hand. Deliberately leaves
  // GSTIN and seller email untouched -- see fetchShopSellerInfo's own
  // comment for why those two aren't auto-fetched.
  const fetchShopInfoFetcher = useFetcher();
  const isFetchingShopInfo = fetchShopInfoFetcher.state !== "idle";
  useEffect(() => {
    if (fetchShopInfoFetcher.data?.intent === "fetchShopSellerInfo") {
      if (fetchShopInfoFetcher.data.ok) {
        setInvoiceSellerLegalName(fetchShopInfoFetcher.data.legalName || "");
        setInvoiceSellerAddress(fetchShopInfoFetcher.data.address || "");
        setInvoiceSellerPhone(fetchShopInfoFetcher.data.phone || "");
        setInvoiceSellerState(fetchShopInfoFetcher.data.state || "");
        toast.show("Fetched from Shopify — review below, then Save settings");
      } else {
        toast.show(fetchShopInfoFetcher.data.error || "Couldn't fetch shop info", { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchShopInfoFetcher.data]);
  const fetchShopSellerInfoNow = () => {
    fetchShopInfoFetcher.submit({ intent: "fetchShopSellerInfo" }, { method: "POST" });
  };

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
        invoiceGstin,
        invoiceSellerLegalName,
        invoiceSellerAddress,
        invoiceSellerPhone,
        invoiceSellerEmail,
        invoiceSealImageUrl,
        invoiceLogoImageUrl,
        invoiceSellerState,
        invoiceGstRateLoose,
        invoiceGstRateCustomisation,
        invoiceNumberPrefix,
        invoiceDeliveryDays,
        // Same "don't freeze today's default as a permanent customization"
        // reasoning as orderProcessingEmailTemplate above.
        invoicePdfTemplate:
          invoicePdfTemplate.replace(/\r\n/g, "\n") === data.defaultInvoicePdfTemplate.replace(/\r\n/g, "\n")
            ? ""
            : invoicePdfTemplate,
        invoiceEmailTemplate:
          invoiceEmailTemplate.replace(/\r\n/g, "\n") === data.defaultInvoiceEmailTemplate.replace(/\r\n/g, "\n")
            ? ""
            : invoiceEmailTemplate,
        invoiceCollectionGstRates: JSON.stringify(collectionGstRates),
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

          <TemplateCard icon={<Icon name="tag" size={15} color={brand.accent} />} title="GST Tax Invoice">
            <p style={{ ...hintStyle, marginTop: 0 }}>
              Never sends automatically — only when someone clicks "Send Invoice" on an order's page in Shopify
              Admin (or from the <a href="/app/invoices" style={{ color: brand.accent }}>GST Invoices</a> page).
              Generates a GST invoice PDF and emails it to the customer.
            </p>

            <div style={{ display: "flex", gap: "6px", marginBottom: "18px", borderBottom: `1px solid ${brand.divider}` }}>
              {[
                { id: "email", label: "Invoice Email" },
                { id: "pdf", label: "Invoice PDF" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInvoiceTab(tab.id)}
                  style={{
                    padding: "9px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    border: "none",
                    background: "transparent",
                    color: invoiceTab === tab.id ? brand.accent : brand.muted,
                    borderBottom: invoiceTab === tab.id ? `2px solid ${brand.accent}` : "2px solid transparent",
                    marginBottom: "-1px",
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {invoiceTab === "email" && (
              <>
                <p style={{ ...hintStyle, marginTop: 0 }}>
                  The message the customer actually receives, with the invoice PDF attached. Pick a design below,
                  then edit its raw HTML freely — or leave it as-is to keep the built-in design.
                </p>
                <Explain summary="ℹ️ Available placeholders (substituted automatically when the invoice email sends)">
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: brand.muted, lineHeight: 1.8 }}>
                    {data.orderInvoiceEmailPlaceholders.map((p) => (
                      <li key={p.token}>
                        <code style={{ background: brand.panel, padding: "1px 5px", borderRadius: "4px" }}>{`{{${p.token}}}`}</code> — {p.description}
                      </li>
                    ))}
                  </ul>
                </Explain>

                <PresetPicker presets={EMAIL_TEMPLATE_PRESETS} getHtml={getEmailPresetHtml} onApply={setInvoiceEmailTemplate} />

                <label style={labelStyle} htmlFor="invoiceEmailTemplate">Invoice email HTML</label>
                <textarea
                  id="invoiceEmailTemplate"
                  value={invoiceEmailTemplate}
                  onChange={(e) => setInvoiceEmailTemplate(e.target.value)}
                  spellCheck={false}
                  style={{ ...fieldStyle, fontFamily: brand.mono, fontSize: "11.5px", lineHeight: 1.5, height: "260px", resize: "vertical", whiteSpace: "pre" }}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setShowInvoiceEmailPreview((v) => !v)} style={{ ...primaryBtn, padding: "8px 16px", fontSize: "12.5px" }}>
                    {showInvoiceEmailPreview ? "Hide preview" : "Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Reset to the built-in default template? This discards your current edits (not saved until you click Save settings).")) {
                        setInvoiceEmailTemplate(data.defaultInvoiceEmailTemplate);
                      }
                    }}
                    style={{ ...secondaryBtn, padding: "8px 16px", fontSize: "12.5px" }}
                  >
                    Reset to default
                  </button>
                </div>
                {showInvoiceEmailPreview && (
                  <div style={{ marginTop: "10px", border: `1px solid ${brand.border}`, borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "6px 10px", background: brand.panel, borderBottom: `1px solid ${brand.divider}`, fontSize: "11px", color: brand.muted }}>
                      Preview with sample data — this reflects what's in the box above right now, even if unsaved.
                    </div>
                    <iframe title="Invoice email preview" srcDoc={renderInvoiceEmailPreview(invoiceEmailTemplate)} style={{ width: "100%", height: "500px", border: "none", display: "block" }} />
                  </div>
                )}
              </>
            )}

            {invoiceTab === "pdf" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Seller details</label>
                  <button
                    type="button"
                    onClick={fetchShopSellerInfoNow}
                    disabled={isFetchingShopInfo}
                    style={{ ...secondaryBtn, padding: "6px 12px", fontSize: "12px" }}
                  >
                    {isFetchingShopInfo ? "Fetching…" : "⟳ Fetch from Shopify"}
                  </button>
                </div>
                <p style={{ ...hintStyle, marginTop: 0 }}>
                  Pulls name/address/phone/state from your Shopify Settings → General billing address — review before
                  saving. GSTIN and business email always need entering by hand (not reliably available via the API).
                </p>

                <label style={labelStyle} htmlFor="invoiceSellerLegalName">Registered business name</label>
                <input
                  id="invoiceSellerLegalName"
                  style={fieldStyle}
                  type="text"
                  value={invoiceSellerLegalName}
                  onChange={(e) => setInvoiceSellerLegalName(e.target.value)}
                  placeholder="Only Natural Gemstones"
                />

                <label style={labelStyle} htmlFor="invoiceSellerAddress">Registered business address</label>
                <textarea
                  id="invoiceSellerAddress"
                  style={{ ...fieldStyle, height: "70px", resize: "vertical" }}
                  value={invoiceSellerAddress}
                  onChange={(e) => setInvoiceSellerAddress(e.target.value)}
                  placeholder={"L-75-76, Lajpat Nagar 2\nNew Delhi, Delhi, 110024\nIndia"}
                />

                <div style={{ display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceSellerPhone">Business phone</label>
                    <input
                      id="invoiceSellerPhone"
                      style={fieldStyle}
                      type="text"
                      value={invoiceSellerPhone}
                      onChange={(e) => setInvoiceSellerPhone(e.target.value)}
                      placeholder="+91-8010-555-111"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceSellerEmail">Business email</label>
                    <input
                      id="invoiceSellerEmail"
                      style={fieldStyle}
                      type="text"
                      value={invoiceSellerEmail}
                      onChange={(e) => setInvoiceSellerEmail(e.target.value)}
                      placeholder="support@onlynaturalgemstones.com"
                    />
                  </div>
                </div>

                <label style={labelStyle} htmlFor="invoiceGstin">GSTIN</label>
                <input
                  id="invoiceGstin"
                  style={fieldStyle}
                  type="text"
                  value={invoiceGstin}
                  onChange={(e) => setInvoiceGstin(e.target.value)}
                  placeholder="e.g. 07ABCDE1234F1Z5"
                />

                <label style={labelStyle} htmlFor="invoiceSellerState">Your state (for CGST+SGST vs IGST)</label>
                <input
                  id="invoiceSellerState"
                  style={fieldStyle}
                  type="text"
                  value={invoiceSellerState}
                  onChange={(e) => setInvoiceSellerState(e.target.value)}
                  placeholder="e.g. Delhi — must match how the customer's state is spelled on their order"
                />

                <div style={{ display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceGstRateLoose">GST rate — loose gemstones (%)</label>
                    <input
                      id="invoiceGstRateLoose"
                      style={fieldStyle}
                      type="text"
                      inputMode="decimal"
                      value={invoiceGstRateLoose}
                      onChange={(e) => setInvoiceGstRateLoose(e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceGstRateCustomisation">GST rate — customisation (%)</label>
                    <input
                      id="invoiceGstRateCustomisation"
                      style={fieldStyle}
                      type="text"
                      inputMode="decimal"
                      value={invoiceGstRateCustomisation}
                      onChange={(e) => setInvoiceGstRateCustomisation(e.target.value)}
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
                <p style={{ ...hintStyle, marginTop: "-10px" }}>
                  International orders are still taxed (as IGST), at whichever rate applies to each line —
                  never zero-rated.
                </p>

                <label style={labelStyle}>GST rate by collection (optional overrides)</label>
                <p style={{ ...hintStyle, marginTop: "5px" }}>
                  Leave blank to use the loose-gemstone rate above. If a gemstone belongs to a collection listed here,
                  its own line AND its linked "Gemstone Customisation" charge line (if customised) both use this rate
                  instead of the two defaults above.
                </p>
                {data.collections.length === 0 ? (
                  <p style={hintStyle}>No collections found on this store.</p>
                ) : (
                  <div style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
                    {data.collections.map((c, i) => (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                          padding: "8px 12px",
                          borderTop: i === 0 ? "none" : `1px solid ${brand.divider}`,
                          background: i % 2 === 0 ? "#fff" : brand.panel,
                        }}
                      >
                        <span style={{ fontSize: "12.5px", color: brand.body }}>{c.title}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={{ width: "80px", padding: "6px 8px", borderRadius: "6px", border: `1px solid ${brand.border}`, fontSize: "12.5px", textAlign: "right" }}
                          value={collectionGstRates[c.id] || ""}
                          onChange={(e) => setCollectionRate(c.id, e.target.value)}
                          placeholder="e.g. 0.25"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceNumberPrefix">Invoice number prefix</label>
                    <input
                      id="invoiceNumberPrefix"
                      style={fieldStyle}
                      type="text"
                      value={invoiceNumberPrefix}
                      onChange={(e) => setInvoiceNumberPrefix(e.target.value)}
                      placeholder={`${data.defaultInvoiceNumberPrefix} (default if left blank)`}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceDeliveryDays">Delivery-before days (shown on PDF)</label>
                    <input
                      id="invoiceDeliveryDays"
                      style={fieldStyle}
                      type="text"
                      inputMode="numeric"
                      value={invoiceDeliveryDays}
                      onChange={(e) => setInvoiceDeliveryDays(e.target.value)}
                      placeholder="10 (default if left blank)"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceLogoImageUrl">Logo image URL (optional)</label>
                    <input
                      id="invoiceLogoImageUrl"
                      style={fieldStyle}
                      type="text"
                      value={invoiceLogoImageUrl}
                      onChange={(e) => setInvoiceLogoImageUrl(e.target.value)}
                      placeholder="https://cdn.shopify.com/..."
                    />
                    <p style={{ ...hintStyle, marginTop: "-10px" }}>
                      Shown at the top of the invoice PDF. Leave blank to automatically use your store's own logo
                      instead.
                    </p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle} htmlFor="invoiceSealImageUrl">Signature/seal image URL (optional)</label>
                    <input
                      id="invoiceSealImageUrl"
                      style={fieldStyle}
                      type="text"
                      value={invoiceSealImageUrl}
                      onChange={(e) => setInvoiceSealImageUrl(e.target.value)}
                      placeholder="https://cdn.shopify.com/..."
                    />
                    <p style={{ ...hintStyle, marginTop: "-10px" }}>
                      Shown above "Authorised Seal &amp; Signatory". Leave blank to show just the text, no image.
                    </p>
                  </div>
                </div>
                <p style={{ ...hintStyle, marginTop: "-6px" }}>
                  For either image: upload it under Settings → Files in Shopify Admin, then paste its link here.
                </p>

                <label style={labelStyle}>Invoice numbering</label>
                <p style={{ ...hintStyle, marginTop: "5px" }}>
                  An invoice's number is your prefix above plus that order's own number — e.g. order{" "}
                  <strong>ONG1028</strong> becomes <strong>{invoiceNumberPrefix || data.defaultInvoiceNumberPrefix}1028</strong>.
                  Assigned once per order and never changes on resend, even if you edit the prefix afterward.
                </p>

                <Explain summary="ℹ️ Available placeholders (substituted automatically when the invoice is generated)">
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: brand.muted, lineHeight: 1.8 }}>
                    {data.orderInvoicePlaceholders.map((p) => (
                      <li key={p.token}>
                        <code style={{ background: brand.panel, padding: "1px 5px", borderRadius: "4px" }}>{`{{${p.token}}}`}</code> — {p.description}
                      </li>
                    ))}
                  </ul>
                </Explain>

                <PresetPicker presets={PDF_TEMPLATE_PRESETS} getHtml={getPdfPresetHtml} onApply={setInvoicePdfTemplate} />

                <label style={labelStyle} htmlFor="invoicePdfTemplate">Invoice PDF HTML</label>
                <textarea
                  id="invoicePdfTemplate"
                  value={invoicePdfTemplate}
                  onChange={(e) => setInvoicePdfTemplate(e.target.value)}
                  spellCheck={false}
                  style={{ ...fieldStyle, fontFamily: brand.mono, fontSize: "11.5px", lineHeight: 1.5, height: "260px", resize: "vertical", whiteSpace: "pre" }}
                />
                <p style={{ ...hintStyle, marginTop: "6px" }}>
                  Rendered without a browser engine (no Puppeteer) to keep this app's hosting light — every style
                  must be inline (<code>style="..."</code>) on the element itself, not in a &lt;style&gt; block or
                  CSS class — those are silently ignored by the real PDF even though they'd show up fine in the
                  preview below. Stick to table-based layouts, not flexbox/grid/absolute positioning.
                </p>
                <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setShowInvoicePreview((v) => !v)} style={{ ...primaryBtn, padding: "8px 16px", fontSize: "12.5px" }}>
                    {showInvoicePreview ? "Hide preview" : "Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Reset to the built-in default template? This discards your current edits (not saved until you click Save settings).")) {
                        setInvoicePdfTemplate(data.defaultInvoicePdfTemplate);
                      }
                    }}
                    style={{ ...secondaryBtn, padding: "8px 16px", fontSize: "12.5px" }}
                  >
                    Reset to default
                  </button>
                </div>
                {showInvoicePreview && (
                  <div style={{ marginTop: "10px", border: `1px solid ${brand.border}`, borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ padding: "6px 10px", background: brand.panel, borderBottom: `1px solid ${brand.divider}`, fontSize: "11px", color: brand.muted }}>
                      Preview with sample data — reflects the HTML box above, even if unsaved. The real PDF's exact fonts/
                      spacing may differ slightly from this browser preview since the PDF is rendered by pdfmake, not a browser.
                    </div>
                    <iframe title="Invoice PDF preview" srcDoc={renderInvoicePreview(invoicePdfTemplate)} style={{ width: "100%", height: "500px", border: "none", display: "block" }} />
                  </div>
                )}
              </>
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
