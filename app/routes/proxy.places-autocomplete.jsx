/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/places-autocomplete?q=<query>
 * (routed via [app_proxy] in shopify.app.toml, same as proxy.jsx — Shopify
 * signs every request that reaches this URL through the proxy, and
 * authenticate.public.appProxy() verifies that signature, so this only
 * ever runs for requests that genuinely came through the customer's own
 * store.)
 *
 * Backs the "Place of Birth" autocomplete on the theme's Personalised
 * Pooja form (see assets/shubh-gems-customizer.js's
 * shubhFetchPlaceSuggestions) — the theme calls this endpoint, never
 * Google directly, so the Google Places API key (Settings page) never
 * reaches the browser.
 *
 * Response (JSON): { suggestions: [{ mainText, secondaryText, fullText }], source }
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";

// Uses Places API (New) -- the legacy `maps/api/place/autocomplete/json`
// endpoint is REQUEST_DENIED ("legacy API ... not enabled for your
// project") on any Google Cloud project created recently enough to only
// have the new API available (confirmed live) -- so this deliberately
// targets the current one, not the older/more commonly-documented one.
async function fetchGoogleSuggestions(query, apiKey) {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({
      input: query,
      includedPrimaryTypes: ["locality"],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google Places error: ${data?.error?.message || res.statusText}`);
  }
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      mainText: p.structuredFormat?.mainText?.text || p.text?.text || "",
      secondaryText: p.structuredFormat?.secondaryText?.text || "",
      fullText: p.text?.text || "",
    }));
}

// Same free lookup the theme used to call directly, before this endpoint
// existed — kept here as the no-key/error fallback so the field never
// hard-fails just because Google isn't configured (or has a bad day).
async function fetchPhotonSuggestions(query) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f) => {
    const props = f.properties || {};
    const main = props.name || props.city || props.street || props.country || "Unknown";
    const rest = [props.city, props.state, props.country].filter(
      (v, idx, arr) => v && v !== main && arr.indexOf(v) === idx,
    );
    return { mainText: main, secondaryText: rest.join(", "), fullText: [main, ...rest].join(", ") };
  });
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // Same "fail closed" reasoning as proxy.jsx — never trust an
    // unauthenticated request even though this endpoint has no side
    // effects, to avoid this becoming an open proxy for arbitrary
    // outbound requests.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return Response.json({ suggestions: [] });
  }

  const settings = await getAppSettings(session.shop);

  if (settings.googlePlacesApiKey) {
    try {
      const suggestions = await fetchGoogleSuggestions(query, settings.googlePlacesApiKey);
      return Response.json({ suggestions, source: "google" });
    } catch (err) {
      console.error(`[proxy.places-autocomplete] shop=${session.shop} Google Places failed, falling back:`, err);
    }
  }

  try {
    const suggestions = await fetchPhotonSuggestions(query);
    return Response.json({ suggestions, source: "photon" });
  } catch (err) {
    console.error(`[proxy.places-autocomplete] shop=${session.shop} Photon fallback also failed:`, err);
    return Response.json({ suggestions: [], source: "none" });
  }
};
