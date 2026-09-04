/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/reviews
 * (routed via [app_proxy] in shopify.app.toml, same as proxy.metal-rates.jsx
 * — Shopify signs every request that reaches this URL through the proxy,
 * and authenticate.public.appProxy() verifies that signature, so this
 * only ever runs for requests that genuinely came through the customer's
 * own store.)
 *
 * Serves the curated Google Reviews entered on this app's own Reviews
 * page (app.reviews.jsx) to the storefront:
 *
 *   GET /apps/customize/reviews             -> every ACTIVE review
 *     (the theme's homepage section calls this with no collection param
 *     — every active review shows on the homepage, no per-review
 *     selection needed there)
 *   GET /apps/customize/reviews?collection=blue-sapphire
 *     -> only ACTIVE reviews whose saved `collections` list includes
 *        that exact handle (empty/no match -> empty array, not an error
 *        — the theme section should just render nothing in that case)
 *
 * Response (JSON): { reviews: [{ authorName, rating, reviewText,
 * reviewDate, photoUrl }, ...] }
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // Same "fail closed" reasoning as proxy.metal-rates.jsx.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const collectionHandle = url.searchParams.get("collection")?.trim() || null;

  const reviews = await prisma.googleReview.findMany({
    where: { shop: session.shop, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  const filtered = collectionHandle
    ? reviews.filter((r) => Array.isArray(r.collections) && r.collections.includes(collectionHandle))
    : reviews;

  return Response.json({
    reviews: filtered.map((r) => ({
      authorName: r.authorName,
      rating: r.rating,
      reviewText: r.reviewText,
      reviewDate: r.reviewDate || null,
      photoUrl: r.photoUrl || null,
    })),
  });
};
