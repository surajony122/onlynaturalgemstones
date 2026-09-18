/**
 * Backend for the "customer-account-hub" Customer Account UI Extension
 * (extensions/customer-account-hub) — returns the signed-in customer's
 * orders/profile/addresses (Admin API) and wishlist/gem recommendation
 * (this app's own database), matched by email. Shares its actual
 * data-building logic with proxy.whatsapp-account-data.jsx (the
 * storefront's separate WhatsApp-OTP account page) via
 * customerAccountData.server.js — this route's only job is resolving
 * WHO the customer is (via Shopify's own session token) before handing
 * off to that shared logic.
 *
 * Public route (no Shopify admin session — this is called cross-origin,
 * directly from Shopify's hosted customer-account pages), but NOT
 * unauthenticated: authenticate.public.customerAccount verifies the
 * request actually carries a valid, signed Shopify customer-account
 * session token (a JWT), same mechanism used throughout the customer
 * account extension platform. See:
 * https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/public/customer-account
 *
 * Reading the signed-in customer's identity (sessionToken.sub) requires
 * this app to have "Protected customer data access" approved in the
 * Partner Dashboard (App setup -> Protected customer data access) — until
 * that's approved, sub may come back empty and this always returns the
 * "not signed in" response.
 */
import { authenticate } from "../shopify.server";
import { adminClientFor } from "../utils/shopify-admin.server";
import { buildCustomerAdminData, buildWishlistAndRecommendation } from "../utils/customerAccountData.server";

export const loader = async ({ request }) => {
  // authenticate.public.customerAccount handles Shopify's CORS preflight
  // (OPTIONS) automatically when called here — nothing else to do.
  await authenticate.public.customerAccount(request);
};

export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const customerGid = sessionToken.sub;
  if (!customerGid) {
    return cors(Response.json({ signedIn: false, wishlist: null, recommendation: null }));
  }

  // sessionToken.dest is the shop's origin, e.g. "https://my-shop.myshopify.com".
  const shop = String(sessionToken.dest || "").replace(/^https?:\/\//, "");
  if (!shop) {
    return cors(Response.json({ error: "Missing shop" }, { status: 400 }));
  }

  let email = null;
  let profile = null;
  let addresses = [];
  let orders = [];
  let admin;
  try {
    admin = await adminClientFor(shop);
    const adminData = await buildCustomerAdminData(admin, customerGid);
    email = adminData.email;
    profile = adminData.profile;
    addresses = adminData.addresses;
    orders = adminData.orders;
  } catch (err) {
    console.error("[public.customer-account-data] failed to resolve customer email/orders:", err);
  }

  if (!email) {
    return cors(
      Response.json({
        signedIn: true,
        wishlist: { items: [] },
        recommendation: null,
        orders: [],
        profile: null,
        addresses: [],
      })
    );
  }

  const { wishlist, recommendation } = await buildWishlistAndRecommendation(admin, shop, { email });

  return cors(Response.json({ signedIn: true, wishlist, recommendation, orders, profile, addresses }));
};
