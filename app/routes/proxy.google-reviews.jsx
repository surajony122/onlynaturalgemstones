/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/google-reviews
 *
 * Called from the theme's Google Reviews section (storefront), never Google
 * directly, so the API key never reaches the browser. Same signed-request
 * mechanism as every other proxy.*.jsx route in this app.
 *
 * Response (JSON): { name, rating, totalReviews, mapsUrl, reviews: [...] }
 * or { error, reviews: [] } if not configured / Google call failed.
 */
import { authenticate } from "../shopify.server";
import { getGoogleReviews } from "../utils/googleReviews.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  const data = await getGoogleReviews(session?.shop);
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=1800" }, // 30 min browser/CDN cache on top of the server-side one
  });
};
