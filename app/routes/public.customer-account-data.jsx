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
  let orders = [];
  try {
    const admin = await adminClientFor(shop);
    const res = await admin.graphql(
      `#graphql
      query CustomerData($id: ID!) {
        customer(id: $id) {
          email
          orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
            edges {
              node {
                name
                processedAt
                statusPageUrl
                displayFulfillmentStatus
                displayFinancialStatus
                currentTotalPriceSet { presentmentMoney { amount currencyCode } }
                lineItems(first: 1) { edges { node { image { url } } } }
              }
            }
          }
        }
      }`,
      { variables: { id: customerGid } }
    );
    const json = await res.json();
    email = json?.data?.customer?.email || null;
    orders = (json?.data?.customer?.orders?.edges || []).map(({ node }) => ({
      name: node.name,
      date: node.processedAt,
      image: node.lineItems?.edges?.[0]?.node?.image?.url || "",
      fulfillmentStatus: node.displayFulfillmentStatus,
      financialStatus: node.displayFinancialStatus,
      total: node.currentTotalPriceSet?.presentmentMoney?.amount
        ? "₹" + Number(node.currentTotalPriceSet.presentmentMoney.amount).toLocaleString("en-IN")
        : null,
      statusUrl: node.statusPageUrl || null,
    }));
  } catch (err) {
    console.error("[public.customer-account-data] failed to resolve customer email/orders:", err);
  }

  if (!email) {
    return cors(Response.json({ signedIn: true, wishlist: { items: [] }, recommendation: null, orders: [] }));
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
    const life = astroLead.recommendation.life || null;
    const benefic = astroLead.recommendation.benefic || null;
    const lucky = astroLead.recommendation.lucky || null;

    let productByCollection = {};
    try {
      const admin = await adminClientFor(shop);
      const handles = [life, benefic, lucky].map((s) => s && s.collection);
      productByCollection = await getFirstProductForCollections(admin, handles);
    } catch (err) {
      console.error("[public.customer-account-data] failed to resolve recommendation products:", err);
    }

    const withProduct = (stone) =>
      stone ? { ...stone, product: productByCollection[stone.collection] || null } : null;

    recommendation = {
      life: withProduct(life),
      benefic: withProduct(benefic),
      lucky: withProduct(lucky),
      resultsUrl,
    };
  }

  return cors(Response.json({ signedIn: true, wishlist, recommendation, orders }));
};

/** For each collection handle, fetches one representative in-stock product
 * (handle/title/image/price) so the recommendation can show a real product
 * card instead of just a bare "Browse collection" link. Same aliased
 * single-request pattern as getProductsByHandles in wishlist.server.js. */
async function getFirstProductForCollections(admin, handles) {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return {};

  try {
    const queryParts = unique.map(
      (h, i) =>
        `c${i}: collectionByHandle(handle: ${JSON.stringify(h)}) {
          products(first: 1, sortKey: BEST_SELLING, query: "available_for_sale:true") {
            edges { node { handle title featuredImage { url } priceRangeV2 { minVariantPrice { amount } } } }
          }
        }`
    );
    const res = await admin.graphql(`#graphql\nquery RecommendationProducts { ${queryParts.join(" ")} }`);
    const json = await res.json();
    const result = {};
    unique.forEach((h, i) => {
      const node = json?.data?.[`c${i}`]?.products?.edges?.[0]?.node;
      if (!node) return;
      result[h] = {
        handle: node.handle,
        title: node.title,
        image: node.featuredImage?.url || "",
        price: node.priceRangeV2?.minVariantPrice?.amount
          ? "₹" + Number(node.priceRangeV2.minVariantPrice.amount).toLocaleString("en-IN")
          : null,
      };
    });
    return result;
  } catch (err) {
    console.error("[public.customer-account-data] getFirstProductForCollections failed:", err);
    return {};
  }
}
