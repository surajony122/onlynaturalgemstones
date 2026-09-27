/**
 * Fetches the store's Google Business Profile reviews via the Places API (New) --
 * same API family as places-autocomplete.server logic already uses (the older
 * `maps.googleapis.com/maps/api/place/*` endpoint returns REQUEST_DENIED on this
 * project, confirmed live -- see proxy.places-autocomplete.jsx's own comment).
 *
 * Google's API only ever returns up to 5 reviews (its own limit, not this app's),
 * picked by Google as "most relevant" -- there is no way to page through every
 * review without the separate, harder-to-get Business Profile API (owner OAuth +
 * Google approval). This is the same ceiling every no-extra-app review widget hits.
 *
 * Cached in-memory per Node process (not the database) since this data only needs
 * to be roughly fresh, not real-time, and avoids spending Google API quota on
 * every storefront page view. Resets on a Render restart/redeploy, which is fine.
 */
import { getAppSettings } from "./appSettings.server";

const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache = null; // { at: number, shop: string, data: object }

async function fetchFromGoogle(placeId, apiKey) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri,reviews",
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google Places error: ${data?.error?.message || res.statusText}`);
  }
  const reviews = (data.reviews || []).map((r) => ({
    authorName: r.authorAttribution?.displayName || "Google user",
    authorPhotoUrl: r.authorAttribution?.photoUri || "",
    rating: r.rating || 0,
    text: r.text?.text || r.originalText?.text || "",
    relativeTime: r.relativePublishTimeDescription || "",
    time: r.publishTime || "",
  }));
  return {
    name: data.displayName?.text || "",
    rating: data.rating || 0,
    totalReviews: data.userRatingCount || 0,
    mapsUrl: data.googleMapsUri || "",
    reviews,
  };
}

export async function getGoogleReviews(shop, opts = {}) {
  if (!opts.skipCache && cache && cache.shop === shop && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }
  const settings = await getAppSettings(shop);
  const apiKey = settings.googlePlacesApiKey;
  const placeId = settings.googlePlaceId;
  if (!apiKey || !placeId) {
    return { error: "Not configured: set the Google Places API key and Place ID in Settings.", reviews: [] };
  }
  try {
    const data = await fetchFromGoogle(placeId, apiKey);
    cache = { at: Date.now(), shop, data };
    return data;
  } catch (err) {
    // Serve a stale cached copy rather than nothing, if we have one, so a transient
    // Google API hiccup doesn't blank out the storefront section.
    if (cache && cache.shop === shop) return cache.data;
    return { error: String((err && err.message) || err), reviews: [] };
  }
}
