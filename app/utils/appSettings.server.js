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
  "interaktWebhookSecret",
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
  interaktWebhookSecret: "INTERAKT_WEBHOOK_SECRET",
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
