/**
 * AstrologyAPI, called from the SERVER.
 *
 * Until now the visitor's browser called AstrologyAPI directly, which meant the account login sat in the page source for anyone to copy,
 * and the app trusted whatever chart data the browser sent back. Now the app makes these calls itself, only AFTER the one-time code has
 * been verified, using the login saved in Settings -> Connections (or the ASTROLOGY_API_USER_ID / ASTROLOGY_API_KEY env vars).
 *
 * If no login is saved yet, fetchAstrologyForSubmission() returns { skipped: true } and the caller carries on exactly as before
 * (using whatever the browser sent), so switching over can be done safely in steps.
 */

const BASE = "https://json.astrologyapi.com/v1/";
const TIMEOUT_MS = 15000;

export function getAstrologyCredentials(settings) {
  const user = String((settings && settings.astrologyUserId) || "").trim();
  const key = String((settings && settings.astrologyApiKey) || "").trim();
  return user && key ? { user, key } : null;
}

async function post(path, body, creds, fetchImpl) {
  const res = await fetchImpl(BASE + path, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(creds.user + ":" + creds.key).toString("base64"),
      "Content-Type": "application/json",
      "Accept-Language": "en",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // never echo the login back in an error message
    throw new Error("AstrologyAPI " + path + " answered HTTP " + res.status + (text ? ": " + text.slice(0, 160) : ""));
  }
  const ct = res.headers.get("content-type") || "";
  return ct.indexOf("json") !== -1 ? res.json() : res.text();
}

/** horo_chart returns 12 houses, house 1 first (the ascendant); the Moon / Sun sign is the house whose planet list holds them. */
export function deriveSignsFromChart(chartData) {
  if (!Array.isArray(chartData) || !chartData.length) return {};
  const result = { ascendant: chartData[0].sign_name || null, moonsign: null, sunsign: null };
  chartData.forEach((house) => {
    const planets = house.planet || [];
    if (planets.indexOf("MOON") !== -1) result.moonsign = house.sign_name;
    if (planets.indexOf("SUN") !== -1) result.sunsign = house.sign_name;
  });
  return result;
}

/** The request body AstrologyAPI wants, from the (already validated) form data. */
export function birthInputFromData(data) {
  const [y, mo, d] = String(data.dob).split("-").map(Number);
  const [h, mi] = String(data.tob).split(":").map(Number);
  const tz = typeof data.tzone === "number" && isFinite(data.tzone) && data.tzone >= -12 && data.tzone <= 14 ? data.tzone : 5.5;
  return { day: d, month: mo, year: y, hour: h, min: mi, lat: data.lat, lon: data.lon, tzone: tz };
}

/**
 * Calculates the chart for one verified submission.
 *   { skipped: true }                                  no login saved yet
 *   { ok: true, astroBirthDetails, astroGemSuggestion, astroChartSvg }
 *   { ok: false, error }                               AstrologyAPI refused / timed out (the caller saves the lead without a chart)
 */
export async function fetchAstrologyForSubmission(settings, data, fetchImpl = globalThis.fetch) {
  const creds = getAstrologyCredentials(settings);
  if (!creds) return { skipped: true };
  const birthInput = birthInputFromData(data);
  try {
    // This plan has no "planets" endpoint: the gem suggestion comes from basic_gem_suggestion and the signs are derived from horo_chart.
    const [birthDetails, gemSuggestion, chartData] = await Promise.all([
      post("birth_details", birthInput, creds, fetchImpl),
      post("basic_gem_suggestion", birthInput, creds, fetchImpl),
      post("horo_chart/north-indian", birthInput, creds, fetchImpl),
    ]);
    const signs = deriveSignsFromChart(chartData);
    const astroBirthDetails = { ...(birthDetails || {}), ascendant: signs.ascendant, moonsign: signs.moonsign, sunsign: signs.sunsign };
    // The drawn chart is nice to have: a failure here must not fail the whole submission.
    let astroChartSvg = null;
    try {
      const img = await post("horo_chart_image/north-indian", birthInput, creds, fetchImpl);
      astroChartSvg = typeof img === "string" ? img : (img && img.svg) || null;
    } catch (err) {
      console.error("[astrologyApi] chart image failed (continuing without it):", String((err && err.message) || err).slice(0, 200));
    }
    return { ok: true, astroBirthDetails, astroGemSuggestion: gemSuggestion, astroChartSvg };
  } catch (err) {
    console.error("[astrologyApi] chart calculation failed:", String((err && err.message) || err).slice(0, 300));
    return { ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }
}

/** The Settings "Test connection" button: one cheap call with a sample birth. */
export async function testAstrologyConnection(settings, fetchImpl = globalThis.fetch) {
  const creds = getAstrologyCredentials(settings);
  if (!creds) return { ok: false, detail: "Enter the User ID and API Key, press Save, then test." };
  try {
    const r = await post("birth_details", { day: 15, month: 8, year: 1990, hour: 3, min: 1, lat: 28.6139, lon: 77.209, tzone: 5.5 }, creds, fetchImpl);
    return r && r.sunrise ? { ok: true, detail: "Connected - AstrologyAPI answered." } : { ok: false, detail: "AstrologyAPI answered, but not with the expected data." };
  } catch (err) {
    return { ok: false, detail: String((err && err.message) || err).slice(0, 200) };
  }
}
