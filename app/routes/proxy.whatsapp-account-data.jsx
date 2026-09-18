/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-account-data
 *
 * Step 3 of the storefront's separate WhatsApp-OTP "My Account" page —
 * given a session token from proxy.whatsapp-otp-verify.jsx, resolves the
 * phone number it belongs to, finds that phone's Shopify customer record
 * (if one exists) via the Admin API, and returns the same shape of data
 * the Customer Account Hub extension shows (orders/wishlist/
 * recommendation/profile/addresses) — built from the exact same shared
 * logic in customerAccountData.server.js, just resolved by phone instead
 * of by a Shopify session token's GID.
 *
 * Request body (JSON): { token }
 * Response (JSON): { ok: true, wishlist, recommendation, orders, profile, addresses }
 *               or { ok: false, error } (e.g. expired/invalid token)
 */
import { authenticate } from "../shopify.server";
import { buildCustomerAdminData, buildWishlistAndRecommendation, findCustomerGidByPhone } from "../utils/customerAccountData.server";
import { resolvePhoneFromToken } from "../utils/whatsappOtpAuth.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session?.shop) {
    return Response.json({ ok: false, error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const phone = await resolvePhoneFromToken(data.token);
  if (!phone) {
    return Response.json({ ok: false, error: "Session expired. Please log in again." }, { status: 401 });
  }

  let profile = null;
  let addresses = [];
  let orders = [];
  let email = null;
  try {
    const customerGid = await findCustomerGidByPhone(admin, phone);

    if (customerGid) {
      const adminData = await buildCustomerAdminData(admin, customerGid);
      email = adminData.email;
      profile = adminData.profile;
      addresses = adminData.addresses;
      orders = adminData.orders;
    }
  } catch (err) {
    console.error("[proxy.whatsapp-account-data] failed to resolve customer by phone:", err);
  }

  // No Shopify customer record yet doesn't mean "nothing to show" — a
  // wishlist/recommendation lead can exist purely in this app's own
  // database, keyed by phone, with no matching Shopify customer at all.
  const { wishlist, recommendation } = await buildWishlistAndRecommendation(admin, session.shop, { email, phone });

  return Response.json({ ok: true, wishlist, recommendation, orders, profile, addresses });
};
