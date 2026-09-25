/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/wishlist-fetch
 *
 * Called from assets/shubh-wishlist.js right after someone on a new device
 * enters their email + phone to wishlist a product, so the wishlist they
 * already saved elsewhere can be merged in and shown.
 *
 * Request body (JSON): { email, phone }
 * Response (JSON): { handles: [...] } -- empty unless the phone matches the one
 * on file for that email.
 */
import { authenticate } from "../shopify.server";
import { fetchSavedWishlist } from "../utils/wishlist.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ handles: [] }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ handles: [] }, { status: 400 });
  }

  try {
    const result = await fetchSavedWishlist(admin, session?.shop, data.email, data.phone);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.wishlist-fetch] unhandled error:", err);
    return Response.json({ handles: [] }, { status: 500 });
  }
};
