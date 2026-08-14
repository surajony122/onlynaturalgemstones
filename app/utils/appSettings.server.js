/**
 * Per-shop settings, editable from app/routes/app.settings.jsx — Gmail
 * sending credentials and the Google Sheets mirror target. A saved
 * AppSettings row takes priority; any field left blank there falls back
 * to the matching environment variable, so existing Render env vars keep
 * working as defaults even before anyone visits the Settings page.
 */
import prisma from "../db.server";

const FIELDS = [
  "gmailUser",
  "gmailAppPassword",
  "googleServiceAccountEmail",
  "googleServiceAccountPrivateKey",
  "astroLeadsSpreadsheetId",
  "wishlistEmailIntervalHours",
  "interaktApiKey",
  "interaktTemplateName",
  "whatsappIntervalValue",
  "whatsappIntervalUnit",
];

const ENV_FALLBACK = {
  gmailUser: "GMAIL_USER",
  gmailAppPassword: "GMAIL_APP_PASSWORD",
  googleServiceAccountEmail: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  googleServiceAccountPrivateKey: "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  astroLeadsSpreadsheetId: "ASTRO_LEADS_SPREADSHEET_ID",
  wishlistEmailIntervalHours: "WISHLIST_EMAIL_INTERVAL_HOURS",
  interaktApiKey: "INTERAKT_API_KEY",
  interaktTemplateName: "INTERAKT_GEM_TEMPLATE_NAME",
  whatsappIntervalValue: "WHATSAPP_INTERVAL_VALUE",
  whatsappIntervalUnit: "WHATSAPP_INTERVAL_UNIT",
};

// Off by default — "0" (or blank) means send immediately, matching
// behaviour from before pacing existed. Days/hours/minutes all valid.
export const DEFAULT_WHATSAPP_INTERVAL_VALUE = "0";
export const DEFAULT_WHATSAPP_INTERVAL_UNIT = "minutes";
const UNIT_TO_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

/** Milliseconds represented by a shop's whatsappIntervalValue/Unit
 * settings — 0 means pacing is off (send immediately). Used by both the
 * queue processor and anywhere that needs to decide "is pacing on". */
export function whatsappIntervalMs(settings) {
  const value = parseFloat(settings.whatsappIntervalValue || "0");
  const unit = settings.whatsappIntervalUnit || DEFAULT_WHATSAPP_INTERVAL_UNIT;
  if (!value || value <= 0) return 0;
  return value * (UNIT_TO_MS[unit] || UNIT_TO_MS.minutes);
}

/** whatsappLastSentAt is a real DateTime column, not a string like the
 * rest of this model — doesn't fit the generic FIELDS/getAppSettings
 * pattern above, so it gets its own small read/write pair. */
export async function getWhatsappLastSentAt(shop) {
  if (!shop) return null;
  const row = await prisma.appSettings.findUnique({ where: { shop }, select: { whatsappLastSentAt: true } });
  return row?.whatsappLastSentAt || null;
}

export async function setWhatsappLastSentAt(shop, date) {
  await prisma.appSettings.upsert({
    where: { shop },
    create: { shop, whatsappLastSentAt: date },
    update: { whatsappLastSentAt: date },
  });
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
  return resolved;
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
