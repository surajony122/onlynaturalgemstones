/**
 * Live, non-destructive "is this actually working" checks for every
 * external service this app's Settings page lets you configure — shared
 * between app.settings.jsx (per-service status badges) and
 * app.server-health.jsx (the full diagnostics table), so there's exactly
 * one implementation of what "connected" means for each service instead
 * of two that could quietly drift apart.
 *
 * Every check returns { ok, detail }:
 *   ok === true   -> confirmed working
 *   ok === false  -> confirmed broken (credentials rejected, unreachable, etc.)
 *   ok === null   -> not configured (nothing to check — usually fine,
 *                    e.g. an optional service nobody's set up yet)
 *   ok === "warn" -> configured and probably fine, but this specific
 *                    check couldn't fully confirm it (see detail)
 */
import nodemailer from "nodemailer";
import { google } from "googleapis";

export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)),
  ]);
}

export async function checkGmail(settings) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return { ok: null, detail: "Not configured — set Gmail address + App Password below." };
  }
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    });
    await withTimeout(transporter.verify(), 8000, "Gmail SMTP");
    return { ok: true, detail: `Authenticated as ${settings.gmailUser}` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

export async function checkGoogleSheets(settings) {
  // Relay path (see googleSheets.server.js) takes priority when set, same
  // as the actual mirror code. A plain GET (doGet in the deployed Apps
  // Script) is a safe, non-destructive reachability check — it can't
  // confirm the shared secret is correct without actually writing a row,
  // which this deliberately avoids doing on every page load.
  if (settings.sheetsRelayUrl) {
    try {
      const res = await withTimeout(fetch(settings.sheetsRelayUrl, { method: "GET" }), 8000, "Sheets relay");
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, detail: `Relay URL unreachable — HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      return {
        ok: true,
        detail: "Sheets relay (Apps Script Web App) is reachable. This only confirms the deployment responds — it can't verify the shared secret without writing a real row.",
      };
    } catch (err) {
      return { ok: false, detail: "Relay URL unreachable: " + String(err?.message || err) };
    }
  }

  if (!settings.googleServiceAccountEmail || !settings.googleServiceAccountPrivateKey || !settings.astroLeadsSpreadsheetId) {
    return { ok: null, detail: "Not configured — optional, leads/events still save to the database regardless." };
  }
  try {
    const privateKey = settings.googleServiceAccountPrivateKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: settings.googleServiceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await withTimeout(
      sheets.spreadsheets.get({ spreadsheetId: settings.astroLeadsSpreadsheetId }),
      8000,
      "Google Sheets"
    );
    return { ok: true, detail: `Connected to "${meta.data.properties?.title || settings.astroLeadsSpreadsheetId}"` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

export async function checkInterakt(settings) {
  if (!settings.interaktApiKey) {
    return { ok: null, detail: "Not configured — paste your Secret Key below." };
  }
  try {
    // Contacts Retrieval API, limit=1 — the lightest real call Interakt
    // offers that both proves the key is valid and never sends/costs
    // anything (unlike the Send Template API, which would actually
    // message someone just to run a health check).
    const res = await withTimeout(
      fetch("https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=1", {
        headers: { Authorization: "Basic " + settings.interaktApiKey },
      }),
      8000,
      "Interakt API"
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: `HTTP ${res.status}: Secret Key rejected — check it's copied correctly from Interakt → Settings → Developer Setting.` };
    }
    if (res.status === 405) {
      // Seen live with a real, working key — this specific diagnostic
      // endpoint (Contacts Retrieval) rejected the call, but the actual
      // Send Template API kept sending real messages successfully at the
      // same time. Downgraded to a warning rather than a hard failure.
      return {
        ok: "warn",
        detail: "HTTP 405 from this diagnostic endpoint specifically — does NOT mean sending is broken. Use a Send Test button below to confirm the path that actually matters.",
      };
    }
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, detail: "Secret Key valid — account connected. This doesn't confirm any individual template is Meta-approved; use each template's Send Test button for that." };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

// Deliberately calls the same Places API (New) endpoint that
// proxy.places-autocomplete.jsx actually uses for the storefront's Place
// of Birth field — this used to call the legacy `maps/api/place/
// autocomplete/json` endpoint instead, which reports REQUEST_DENIED on
// any Google Cloud project that only has the new API enabled (the normal
// case for a recently-created project), making this show "Failing" even
// when the real feature was working fine. Confirmed live.
export async function checkGooglePlaces(settings) {
  if (!settings.googlePlacesApiKey) {
    return { ok: null, detail: "Not configured — falling back to the free Photon/OpenStreetMap lookup." };
  }
  try {
    const res = await withTimeout(
      fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": settings.googlePlacesApiKey },
        body: JSON.stringify({ input: "Mumbai", includedPrimaryTypes: ["locality"] }),
      }),
      8000,
      "Google Places API"
    );
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, detail: `${json?.error?.message || res.statusText} — check the key is correct and "Places API (New)" is enabled in Google Cloud Console.` };
    }
    return { ok: true, detail: "Key valid — city autocomplete is live." };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}
