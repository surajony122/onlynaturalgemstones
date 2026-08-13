/**
 * Best-effort mirror of AstroLead/EmailEvent rows into the same Google
 * Sheet the old Apps Script backend (Code.gs) used to write directly —
 * so the existing "just open the Sheet" review habit keeps working even
 * though the database (see prisma/schema.prisma) is now the real source
 * of truth for this data.
 *
 * Takes a resolved settings object (see appSettings.server.js's
 * getAppSettings) rather than reading process.env directly — settings
 * are per-shop and may come from the Settings page (app.settings.jsx)
 * instead of an env var. Entirely optional: if the settings passed in
 * don't have all three of googleServiceAccountEmail /
 * googleServiceAccountPrivateKey / astroLeadsSpreadsheetId, every
 * function here just logs once per key and returns — never throws,
 * never blocks the caller.
 */
import { google } from "googleapis";

const LEADS_SHEET_NAME = "Leads";
const EMAIL_EVENTS_SHEET_NAME = "EmailEvents";

const LEADS_HEADER = [
  "Timestamp", "Name", "Email", "Phone", "Gender", "Purpose", "Body Weight (kg)",
  "DOB", "TOB", "Place of Birth", "Ascendant", "Moon Sign", "Sun Sign",
  "Life Stone", "Life Stone Planet", "Benefic Stone", "Lucky Stone",
  "Calculation Status", "Tracking ID",
];
const EMAIL_EVENTS_HEADER = ["Timestamp", "Tracking ID", "Event", "Detail"];

// Cache Sheets clients per spreadsheet+service-account-email pair, since
// settings can now differ across shops (in a future multi-shop world) —
// keyed loosely rather than assuming one global client is always right.
const clientCache = new Map();
const warnedMissingConfig = new Set();

function isConfigured(settings, cacheKey) {
  const configured =
    !!settings?.googleServiceAccountEmail &&
    !!settings?.googleServiceAccountPrivateKey &&
    !!settings?.astroLeadsSpreadsheetId;
  if (!configured && !warnedMissingConfig.has(cacheKey)) {
    warnedMissingConfig.add(cacheKey);
    console.warn(
      "[googleSheets.server] Google service account email/private key/spreadsheet ID not fully set " +
        "(Settings page or env vars) — Sheet mirroring is disabled, the database is still the source of truth."
    );
  }
  return configured;
}

function getSheetsClient(settings) {
  const cacheKeyForClient = settings.googleServiceAccountEmail + "|" + settings.astroLeadsSpreadsheetId;
  if (clientCache.has(cacheKeyForClient)) return clientCache.get(cacheKeyForClient);
  // The private key field can't hold real newlines in a Render env var or
  // a plain <textarea> paste — stored/entered with literal "\n"
  // sequences, un-escaped here.
  const privateKey = (settings.googleServiceAccountPrivateKey || "").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: settings.googleServiceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = google.sheets({ version: "v4", auth });
  clientCache.set(cacheKeyForClient, client);
  return client;
}

/** Ensures a tab with the given name + header row exists, creating both
 * if this is the very first row ever written — mirrors Code.gs's
 * `ss.getSheetByName(name) || ss.insertSheet(name)` + header-on-first-row
 * pattern exactly. */
async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }
}

async function appendRow(settings, sheetName, header, row) {
  const cacheKey = (settings?.astroLeadsSpreadsheetId || "") + ":" + sheetName;
  if (!isConfigured(settings, cacheKey)) return;
  try {
    const sheets = getSheetsClient(settings);
    const spreadsheetId = settings.astroLeadsSpreadsheetId;
    await ensureSheetWithHeader(sheets, spreadsheetId, sheetName, header);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Best-effort only — the database row is already safely written by
    // the caller before this ever runs. Never let a Sheets API hiccup
    // (quota, transient network error, revoked share) affect anything.
    console.error(`[googleSheets.server] failed to append to "${sheetName}":`, err);
  }
}

export async function mirrorLeadToSheet(settings, lead) {
  const rec = lead.recommendation || {};
  await appendRow(settings, LEADS_SHEET_NAME, LEADS_HEADER, [
    new Date(lead.createdAt).toISOString(),
    lead.name || "",
    lead.email || "",
    lead.phone || "",
    lead.gender || "",
    lead.purpose || "",
    lead.bodyWeightKg || "",
    lead.dob || "",
    lead.tob || "",
    lead.placeOfBirth || "",
    lead.ascendant || "",
    lead.moonsign || "",
    lead.sunsign || "",
    (rec.life && rec.life.gem) || "",
    (rec.life && rec.life.planet) || "",
    (rec.benefic && rec.benefic.gem) || "",
    (rec.lucky && rec.lucky.gem) || "",
    lead.calculationOk ? "OK" : "FAILED: " + (lead.astroError || ""),
    lead.trackingId || "",
  ]);
}

export async function mirrorEmailEventToSheet(settings, trackingId, event, detail) {
  await appendRow(settings, EMAIL_EVENTS_SHEET_NAME, EMAIL_EVENTS_HEADER, [
    new Date().toISOString(),
    trackingId || "",
    event || "",
    detail || "",
  ]);
}
