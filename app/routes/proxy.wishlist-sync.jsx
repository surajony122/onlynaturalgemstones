/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/wishlist-sync
 * (same fixed [app_proxy] prefix every public endpoint in this app lives
 * under — see proxy.astro-advice.jsx for why).
 *
 * Called from assets/shubh-wishlist.js's performWishlistSync(), alongside
 * (not instead of) its existing native-form submit to Shopify's customer
 * form — that sync is untouched. This endpoint only adds the "here's what
 * you saved" email + tracking on top.
 *
 * Request body (JSON): { email, phone, productHandles: [...] }
 * Response (JSON): { ok: true, emailSendStatus } or { error }
 */
import { authenticate } from "../shopify.server";
import { handleWishlistSync } from "../utils/wishlist.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    const text = await request.text();
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await handleWishlistSync(admin, session?.shop, data);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.wishlist-sync] unhandled error:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
};
