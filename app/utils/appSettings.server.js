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
};

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
