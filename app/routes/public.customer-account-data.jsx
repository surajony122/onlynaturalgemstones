/**
 * Backend for the "customer-account-hub" Customer Account UI Extension
 * (extensions/customer-account-hub) — returns the signed-in customer's
 * wishlist + gem recommendation, read from this app's own database
 * (WishlistLead / AstroLead), matched by email.
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
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { adminClientFor } from "../utils/shopify-admin.server";
import { buildResultsPageUrl } from "../utils/astroAdvice.server";

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
  try {
    const admin = await adminClientFor(shop);
    const res = await admin.graphql(
      `#graphql
      query CustomerEmail($id: ID!) { customer(id: $id) { email } }`,
      { variables: { id: customerGid } }
    );
    const json = await res.json();
    email = json?.data?.customer?.email || null;
  } catch (err) {
    console.error("[public.customer-account-data] failed to resolve customer email:", err);
  }

  if (!email) {
    return cors(Response.json({ signedIn: true, wishlist: { items: [] }, recommendation: null }));
  }

  const [wishlistLead, astroLead] = await Promise.all([
    prisma.wishlistLead.findFirst({ where: { shop, email }, orderBy: { createdAt: "desc" } }),
    prisma.astroLead.findFirst({ where: { shop, email, calculationOk: true }, orderBy: { createdAt: "desc" } }),
  ]);

  // Stored shape (see getProductsByHandles in wishlist.server.js) is
  // {handle, title, imageUrl, price: <raw amount, unformatted>} — reshape
  // to what the extension expects (image/price as a ready-to-display
  // string) so the extension itself stays a dumb renderer.
  const rawProducts = (wishlistLead && wishlistLead.products) || [];
  const wishlist = {
    items: rawProducts.map((p) => ({
      handle: p.handle,
      title: p.title,
      image: p.imageUrl || "",
      price: p.price ? "₹" + Number(p.price).toLocaleString("en-IN") : null,
    })),
  };

  let recommendation = null;
  if (astroLead && astroLead.recommendation) {
    const resultsUrl = buildResultsPageUrl(
      { name: astroLead.name, dob: astroLead.dob, tob: astroLead.tob, placeOfBirth: astroLead.placeOfBirth },
      { ascendant: astroLead.ascendant },
      astroLead.recommendation
    );
    recommendation = {
      life: astroLead.recommendation.life || null,
      benefic: astroLead.recommendation.benefic || null,
      lucky: astroLead.recommendation.lucky || null,
      resultsUrl,
    };
  }

  return cors(Response.json({ signedIn: true, wishlist, recommendation }));
};
