/**
 * Per-shop settings, editable from app/routes/app.settings.jsx — Gmail
 * sending credentials and the Google Sheets mirror target. A saved
 * AppSettings row takes priority; any field left blank there falls back
 * to the matching environment variable, so existing Render env vars keep
 * working as defaults even before anyone visits the Settings page.
 */
import prisma from "../db.server";
import { DEFAULT_RATES } from "./gemstoneCustomisationMatrix.server";

const FIELDS = [
  "gmailUser",
  "gmailAppPassword",
  "googleServiceAccountEmail",
  "googleServiceAccountPrivateKey",
  "astroLeadsSpreadsheetId",
  "sheetsRelayUrl",
  "sheetsRelaySecret",
  "wishlistEmailIntervalHours",
  "interaktApiKey",
  "interaktTemplateName",
  "interaktOrderTemplateName",
  "interaktWishlistTemplateName",
  "orderProcessingTriggerTag",
  "whatsappIntervalValue",
  "whatsappIntervalUnit",
  "interaktWebhookSecret",
  "googlePlacesApiKey",
  "metalRateSilver",
  "metalRatePanchdhatu",
  "metalRateCopper",
  "metalRateGold22kYellow",
  "metalRateGold18kYellow",
  "metalRateGold18kWhite",
  "metalRateGold14kYellow",
  "metalRateGold14kWhite",
  "metalMakingCharge",
  "metalTaxRate",
];

const ENV_FALLBACK = {
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
  googleServiceAccountEmail: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  googleServiceAccountPrivateKey: "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  astroLeadsSpreadsheetId: "ASTRO_LEADS_SPREADSHEET_ID",
  sheetsRelayUrl: "SHEETS_RELAY_URL",
  sheetsRelaySecret: "SHEETS_RELAY_SECRET",
  wishlistEmailIntervalHours: "WISHLIST_EMAIL_INTERVAL_HOURS",
  interaktApiKey: "INTERAKT_API_KEY",
  interaktTemplateName: "INTERAKT_GEM_TEMPLATE_NAME",
  interaktOrderTemplateName: "INTERAKT_ORDER_TEMPLATE_NAME",
  interaktWishlistTemplateName: "INTERAKT_WISHLIST_TEMPLATE_NAME",
  orderProcessingTriggerTag: "ORDER_PROCESSING_TRIGGER_TAG",
  whatsappIntervalValue: "WHATSAPP_INTERVAL_VALUE",
  whatsappIntervalUnit: "WHATSAPP_INTERVAL_UNIT",
  interaktWebhookSecret: "INTERAKT_WEBHOOK_SECRET",
  googlePlacesApiKey: "GOOGLE_PLACES_API_KEY",
};

// How long AFTER a lead's first (automatic, instant-on-submit) WhatsApp
// message to send ONE follow-up reminder (same template, resent) — NOT a
// pacing/rate-limit between different leads' messages (that's what this
// used to mean; reworked per explicit request into a per-lead first+
// follow-up flow instead — see app/utils/whatsappQueue.server.js).
// Defaults to 24 hours; "0" turns follow-ups off entirely (first message
// still always sends instantly either way).
export const DEFAULT_WHATSAPP_INTERVAL_VALUE = "24";
export const DEFAULT_WHATSAPP_INTERVAL_UNIT = "hours";
const UNIT_TO_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

/** Milliseconds represented by a shop's whatsappIntervalValue/Unit
 * settings (the follow-up delay) — 0 means follow-ups are off. */
export function whatsappIntervalMs(settings) {
  const value = parseFloat(settings.whatsappIntervalValue || "0");
  const unit = settings.whatsappIntervalUnit || DEFAULT_WHATSAPP_INTERVAL_UNIT;
  if (!value || value <= 0) return 0;
  return value * (UNIT_TO_MS[unit] || UNIT_TO_MS.hours);
}

// Used wherever wishlistEmailIntervalHours needs an actual number —
// getAppSettings returns everything as strings (possibly empty), same
// as the rest of this model.
export const DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS = 2;

// The WhatsApp template's code name, used when the Settings page field is
// left blank — must match exactly what's created/approved in Interakt.
// See app/utils/interakt.server.js for the template's expected variable
// layout (this is documented there, not re-derived from anything live).
export const DEFAULT_INTERAKT_TEMPLATE_NAME = "gem_recommendation";

// Second, separate WhatsApp template — the order-processing notification
// (see webhooks.orders.updated.jsx) — used when the Settings page field
// is left blank.
export const DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME = "order_inprocess";

// Third, separate WhatsApp template — the wishlist reminder (see
// sendWishlistWhatsApp in interakt.server.js, sent alongside the
// wishlist email on the same debounced/interval schedule) — used when
// the Settings page field is left blank.
export const DEFAULT_INTERAKT_WISHLIST_TEMPLATE_NAME = "wishlist_reminder";

// Tag that triggers the order-processing WhatsApp send when present on
// an order (see webhooks.orders.updated.jsx) — used when the Settings
// page field is left blank. Chosen deliberately distinctive (not a
// generic word like "processing" that might already exist as an
// unrelated tag) — change it on the Settings page if it collides with
// an existing tagging convention.
export const DEFAULT_ORDER_PROCESSING_TRIGGER_TAG = "notify-processing";

/** Resolved settings for a shop — DB row values win, env vars fill in
 * anything left blank. Always returns a full object, every field a
 * string (possibly empty), never null/undefined — callers can check
 * truthiness directly. */
export async function getAppSettings(shop) {
  const row = shop ? await prisma.appSettings.findUnique({ where: { shop } }) : null;
  const resolved = {};
  for (const field of FIELDS) {
    resolved[field] = (row && row[field]) || process.env[ENV_FALLBACK[field]] || "";
  }
  // System-managed, not a Settings-page form field (no env fallback,
  // never user-editable) — see getOrCreateInteraktCampaignId.
  resolved.interaktCampaignId = (row && row.interaktCampaignId) || "";
  resolved.interaktCampaignTemplateName = (row && row.interaktCampaignTemplateName) || "";
  return resolved;
}

/** Persists the auto-created Interakt API Campaign id + which template it
 * was created for — system-managed (see getOrCreateInteraktCampaignId in
 * interakt.server.js), not part of the generic Settings-page FIELDS/
 * saveAppSettings flow, so it gets its own small setter, same pattern
 * used elsewhere in this file for non-form fields. */
export async function setInteraktCampaign(shop, campaignId, templateName) {
  await prisma.appSettings.upsert({
    where: { shop },
    create: { shop, interaktCampaignId: campaignId, interaktCampaignTemplateName: templateName },
    update: { interaktCampaignId: campaignId, interaktCampaignTemplateName: templateName },
  });
}

/** Raw DB row only (no env fallback) — used by the Settings page itself
 * so the form shows exactly what's actually saved in the database, not
 * a value silently inherited from an env var (which the form can't
 * edit/clear anyway). */
export async function getRawAppSettingsRow(shop) {
  return shop ? prisma.appSettings.findUnique({ where: { shop } }) : null;
}

/** Upserts the shop's settings row. Blank-string fields are stored as
 * null (not empty string) so getAppSettings's `|| env fallback` logic
 * treats "cleared in the form" the same as "never set". */
export async function saveAppSettings(shop, data) {
  const clean = {};
  for (const field of FIELDS) {
    const value = (data[field] || "").trim();
    clean[field] = value || null;
  }
  return prisma.appSettings.upsert({
    where: { shop },
    create: { shop, ...clean },
    update: clean,
  });
}

// Maps DEFAULT_RATES's own key shape (silver, panchdhatu, copper,
// 22k-yellow, 18k-yellow, 18k-white, 14k-yellow, 14k-white, makingCharge,
// taxRate -- see gemstoneCustomisationMatrix.server.js) to this model's
// field names.
const RATE_KEY_TO_FIELD = {
  silver: "metalRateSilver",
  panchdhatu: "metalRatePanchdhatu",
  copper: "metalRateCopper",
  "22k-yellow": "metalRateGold22kYellow",
  "18k-yellow": "metalRateGold18kYellow",
  "18k-white": "metalRateGold18kWhite",
  "14k-yellow": "metalRateGold14kYellow",
  "14k-white": "metalRateGold14kWhite",
  makingCharge: "metalMakingCharge",
  taxRate: "metalTaxRate",
};

/** Persists the metal rates entered on the app's own dashboard
 * (app._index.jsx's "Daily Metal Rates & Pricing Formula" panel) — see
 * that route's "rebuildCustomisationMatrix" action, which calls this
 * before running the matrix rebuild. proxy.metal-rates.jsx reads this
 * same saved row to serve the storefront. */
export async function saveMetalRates(shop, rates) {
  const clean = {};
  for (const [rateKey, field] of Object.entries(RATE_KEY_TO_FIELD)) {
    const value = rates[rateKey];
    clean[field] = value === undefined || value === null || value === "" ? null : String(value);
  }
  return prisma.appSettings.upsert({
    where: { shop },
    create: { shop, ...clean },
    update: clean,
  });
}

/** Resolved rates in DEFAULT_RATES's own key shape — a saved value wins,
 * DEFAULT_RATES fills in anything blank/unparseable. Used by both
 * app._index.jsx's loader (to prefill the dashboard) and
 * proxy.metal-rates.jsx (to serve the storefront). Takes the object
 * getAppSettings/getRawAppSettingsRow already returned — doesn't fetch
 * anything itself. */
export function ratesFromAppSettings(settings) {
  const resolved = {};
  for (const [rateKey, field] of Object.entries(RATE_KEY_TO_FIELD)) {
    const raw = settings ? settings[field] : null;
    const parsed = raw !== undefined && raw !== null && raw !== "" ? parseFloat(raw) : NaN;
    resolved[rateKey] = Number.isFinite(parsed) ? parsed : DEFAULT_RATES[rateKey];
  }
  return resolved;
}
