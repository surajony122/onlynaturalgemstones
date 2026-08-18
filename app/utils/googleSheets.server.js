/**
 * Best-effort mirror of AstroLead/EmailEvent rows into the same Google
 * Sheet the old Apps Script backend (Code.gs) used to write directly —
 * so the existing "just open the Sheet" review habit keeps working even
 * though the database (see prisma/schema.prisma) is now the real source
 * of truth for this data.
 *
 * Rows are PREPENDED (inserted right after the header, pushing existing
 * rows down) rather than appended — newest lead always visible at the
 * top without scrolling. The Sheets API's values.append() call can only
 * ever add to the END of a range, so this needs its own two-step
 * approach: insert a blank row via batchUpdate, then write into it via
 * values.update() — see prependRow().
 *
 * Takes a resolved settings object (see appSettings.server.js's
 * getAppSettings) rather than reading process.env directly — settings
 * are per-shop and may come from the Settings page (app.settings.jsx)
 * instead of an env var. Entirely optional: if the settings passed in
 * don't have all three of googleServiceAccountEmail /
 * googleServiceAccountPrivateKey / astroLeadsSpreadsheetId, every
 * function here just logs once per key and returns — never throws,
 * never blocks the caller. Every function now returns a status string
 * ("OK" / "skipped: ..." / "FAILED: ...") rather than void, purely for
 * debug visibility (see handleAstroAdviceSubmission's debug=true path) —
 * nothing here ever THROWS out to the caller either way.
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

// None of the googleapis calls below had any timeout configured — when
// something's wrong (bad/expired service account key, no share
// permission, network issue reaching Google from Render), the request
// doesn't fail fast, it just hangs indefinitely. Confirmed directly: a
// debug=true submission with a full payload hung 30+ seconds specifically
// at this step, while everything else responded in well under a second.
// Wrapping every Sheets call in this bounds it, so a broken config now
// fails FAST with a real, visible error instead of hanging forever
// (which, in production before this, meant the mirror silently never
// completed at all — not "failed", just never finished).
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

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

// Alternative to the service-account path above — this store's Google
// Workspace org policy (iam.managed.disableServiceAccountKeyCreation)
// blocks creating a service account key entirely, with no override
// available to this account. A tiny Apps Script Web App deployed under
// the merchant's OWN Google account sidesteps that: Apps Script
// deployment isn't gated by that IAM policy at all. If sheetsRelayUrl is
// set, it's tried FIRST; the service-account path above is only used as
// a fallback when the relay isn't configured. See
// scripts/sheets-relay.gs (delivered to the user separately) for the
// Apps Script source this calls.
async function sendViaRelay(settings, sheetName, header, row) {
  const res = await withTimeout(
    fetch(settings.sheetsRelayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: settings.sheetsRelaySecret || "",
        sheetName,
        header,
        row,
      }),
      signal: AbortSignal.timeout(15000),
    }),
    15000,
    `Sheets relay to "${sheetName}"`
  );
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`relay returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.ok) {
    throw new Error(`relay error (HTTP ${res.status}): ${json.error || text.slice(0, 200)}`);
  }
  return "OK";
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

/** A1-style column letter for a 1-based column number (1 -> "A", 27 ->
 * "AA") — our headers are well under 26 columns today, but this stays
 * correct if one ever grows past that. */
function columnLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Ensures a tab with the given name + header row exists, creating both
 * if this is the very first row ever written — mirrors Code.gs's
 * `ss.getSheetByName(name) || ss.insertSheet(name)` + header-on-first-row
 * pattern exactly. Returns the sheet's numeric sheetId (needed for the
 * insertDimension request in prependRow — batchUpdate needs the numeric
 * ID, not the sheet name). */
async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let sheetMeta = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!sheetMeta) {
    const createRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    sheetMeta = createRes.data.replies[0].addSheet;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
  }
  return sheetMeta.properties.sheetId;
}

/** Inserts `row` as a brand new row 2 (right after the header on row 1),
 * pushing every existing data row down by one — newest lead/event always
 * at the top. Two API calls, since the Sheets API has no single
 * "prepend" operation: (1) insertDimension via batchUpdate opens up a
 * blank row 2, (2) values.update writes the actual values into it. */
async function prependRow(settings, sheetName, header, row) {
  // Relay path first — no service account needed at all, so this alone
  // being set is sufficient regardless of the service-account fields.
  if (settings?.sheetsRelayUrl) {
    try {
      return await sendViaRelay(settings, sheetName, header, row);
    } catch (err) {
      console.error(`[googleSheets.server] relay failed for "${sheetName}":`, err);
      return "FAILED (relay): " + String((err && err.message) || err).slice(0, 300);
    }
  }

  const cacheKey = (settings?.astroLeadsSpreadsheetId || "") + ":" + sheetName;
  if (!isConfigured(settings, cacheKey)) {
    return "skipped: Google Sheets not configured (Settings page: Sheets relay URL, or GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / ASTRO_LEADS_SPREADSHEET_ID env vars)";
  }
  try {
    await withTimeout(
      (async () => {
        const sheets = getSheetsClient(settings);
        const spreadsheetId = settings.astroLeadsSpreadsheetId;
        const sheetId = await ensureSheetWithHeader(sheets, spreadsheetId, sheetName, header);

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
                  inheritFromBefore: false,
                },
              },
            ],
          },
        });

        const lastCol = columnLetter(header.length);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A2:${lastCol}2`,
          valueInputOption: "RAW",
          requestBody: { values: [row] },
        });
      })(),
      15000,
      `Sheets mirror to "${sheetName}"`
    );
    return "OK";
  } catch (err) {
    // Best-effort only — the database row is already safely written by
    // the caller before this ever runs. Never let a Sheets API hiccup
    // (quota, transient network error, revoked share) affect anything.
    console.error(`[googleSheets.server] failed to prepend to "${sheetName}":`, err);
    return "FAILED: " + String((err && err.message) || err).slice(0, 300);
  }
}

export async function mirrorLeadToSheet(settings, lead) {
  const rec = lead.recommendation || {};
  return prependRow(settings, LEADS_SHEET_NAME, LEADS_HEADER, [
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
  return prependRow(settings, EMAIL_EVENTS_SHEET_NAME, EMAIL_EVENTS_HEADER, [
    new Date().toISOString(),
    trackingId || "",
    event || "",
    detail || "",
  ]);
}
