/**
 * Best-effort mirror of AstroLead/EmailEvent rows into the same Google
 * Sheet the old Apps Script backend (Code.gs) used to write directly —
 * so the existing "just open the Sheet" review habit keeps working even
 * though the database (see prisma/schema.prisma) is now the real source
 * of truth for this data.
 *
 * Entirely optional: if GOOGLE_SERVICE_ACCOUNT_EMAIL /
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / ASTRO_LEADS_SPREADSHEET_ID aren't
 * all set in the environment, every function here just logs once and
 * returns — never throws, never blocks the caller. See MERGE_ASTRO_ADVICE.md
 * for how to create the service account and share the Sheet with it.
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

let cachedSheetsClient = null;
let warnedMissingConfig = false;

function isConfigured() {
  const configured =
    !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    !!process.env.ASTRO_LEADS_SPREADSHEET_ID;
  if (!configured && !warnedMissingConfig) {
    warnedMissingConfig = true;
    console.warn(
      "[googleSheets.server] GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / " +
        "ASTRO_LEADS_SPREADSHEET_ID not fully set — Sheet mirroring is disabled, the database is " +
        "still the source of truth. See MERGE_ASTRO_ADVICE.md."
    );
  }
  return configured;
}

function getSheetsClient() {
  if (cachedSheetsClient) return cachedSheetsClient;
  // Render's env var UI can't hold real newlines — the private key is
  // stored with literal "\n" sequences and un-escaped here.
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
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

async function appendRow(sheetName, header, row) {
  if (!isConfigured()) return;
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.ASTRO_LEADS_SPREADSHEET_ID;
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

export async function mirrorLeadToSheet(lead) {
  const rec = lead.recommendation || {};
  await appendRow(LEADS_SHEET_NAME, LEADS_HEADER, [
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

export async function mirrorEmailEventToSheet(trackingId, event, detail) {
  await appendRow(EMAIL_EVENTS_SHEET_NAME, EMAIL_EVENTS_HEADER, [
    new Date().toISOString(),
    trackingId || "",
    event || "",
    detail || "",
  ]);
}
