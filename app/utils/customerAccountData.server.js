/**
 * Shared "account data" builder used by BOTH ways a customer can see
 * their orders/wishlist/recommendation/profile/addresses on this store:
 *
 *  - app/routes/public.customer-account-data.jsx — the Customer Account
 *    UI Extension ("My Gemstone Hub"), reached via Shopify's own native
 *    login, identifies the customer by their session token's GID.
 *  - app/routes/proxy.whatsapp-account-data.jsx — the storefront's
 *    separate WhatsApp-OTP-gated "My Account" page (built because this
 *    store's Grow plan has no Multipass to bridge a third-party login
 *    into a real Shopify session), identifies the customer by phone
 *    number instead.
 *
 * Extracted here so both call the exact same order/bundle/recommendation
 * logic and can never drift apart — the only difference between the two
 * callers is HOW they resolve a customer GID and which of email/phone
 * they look up leads by, both handled by the caller before/after calling
 * into this module.
 */
import prisma from "../db.server";
import { buildResultsPageUrl } from "./astroAdvice.server";

/** Reads a customer's profile/addresses/orders (with bundle regrouping)
 * straight from the Admin API. `customerGid` is a full
 * "gid://shopify/Customer/..." id. */
export async function buildCustomerAdminData(admin, customerGid) {
  const res = await admin.graphql(
    `#graphql
    query CustomerData($id: ID!) {
      customer(id: $id) {
        email
        firstName
        lastName
        phone
        defaultAddress { id }
        addresses(first: 20) { id address1 address2 city province zip country }
        orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              name
              processedAt
              statusPageUrl
              displayFulfillmentStatus
              displayFinancialStatus
              currentTotalPriceSet { presentmentMoney { amount currencyCode } }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    image { url }
                    variant { id }
                    customAttributes { key value }
                  }
                }
              }
              fulfillments(first: 5) {
                events(first: 20) {
                  edges { node { status happenedAt } }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: customerGid } }
  );
  const json = await res.json();
  const customerNode = json?.data?.customer;

  const profile = customerNode
    ? {
        name: [customerNode.firstName, customerNode.lastName].filter(Boolean).join(" ") || null,
        email: customerNode.email || null,
        phone: customerNode.phone || null,
      }
    : null;

  const defaultAddressId = customerNode?.defaultAddress?.id || null;
  const addresses = (customerNode?.addresses || [])
    .map((addr) => {
      const formatted = formatAddress(addr);
      return formatted ? { text: formatted, isDefault: addr.id === defaultAddressId } : null;
    })
    .filter(Boolean);

  const orders = (customerNode?.orders?.edges || []).map(({ node }) => ({
    name: node.name,
    date: node.processedAt,
    fulfillmentStatus: node.displayFulfillmentStatus,
    financialStatus: node.displayFinancialStatus,
    total: node.currentTotalPriceSet?.presentmentMoney?.amount
      ? "₹" + Number(node.currentTotalPriceSet.presentmentMoney.amount).toLocaleString("en-IN")
      : null,
    statusUrl: node.statusPageUrl || null,
    timeline: buildOrderTimeline(node),
    bundles: buildOrderBundles(node),
  }));

  return { email: customerNode?.email || null, profile, addresses, orders };
}

/** Reads this app's own wishlist/gem-recommendation leads (WishlistLead /
 * AstroLead), matched by whichever of email/phone the caller has. Tries
 * email first (more leads are keyed by email historically), falling back
 * to phone — either match is equally valid, a lead just needs ONE of the
 * two matching fields to be found. */
export async function buildWishlistAndRecommendation(admin, shop, { email, phone }) {
  const emailWhere = email ? { shop, email } : null;
  const phoneWhere = phone ? { shop, phone } : null;

  const [wishlistLead, astroLead] = await Promise.all([
    emailWhere
      ? prisma.wishlistLead.findFirst({ where: emailWhere, orderBy: { createdAt: "desc" } })
      : phoneWhere
        ? prisma.wishlistLead.findFirst({ where: phoneWhere, orderBy: { createdAt: "desc" } })
        : null,
    emailWhere
      ? prisma.astroLead.findFirst({ where: { ...emailWhere, calculationOk: true }, orderBy: { createdAt: "desc" } })
      : phoneWhere
        ? prisma.astroLead.findFirst({ where: { ...phoneWhere, calculationOk: true }, orderBy: { createdAt: "desc" } })
        : null,
  ]);

  // Stored shape (see getProductsByHandles in wishlist.server.js) is
  // {handle, title, imageUrl, price: <raw amount, unformatted>} — reshape
  // to what callers expect (image/price as a ready-to-display string) so
  // callers stay dumb renderers.
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
      const handles = [life, benefic, lucky].map((s) => s && s.collection);
      productByCollection = await getFirstProductForCollections(admin, handles);
    } catch (err) {
      console.error("[customerAccountData] failed to resolve recommendation products:", err);
    }

    const withProduct = (stone) => (stone ? { ...stone, product: productByCollection[stone.collection] || null } : null);

    recommendation = {
      life: withProduct(life),
      benefic: withProduct(benefic),
      lucky: withProduct(lucky),
      resultsUrl,
    };
  }

  return { wishlist, recommendation };
}

/** Joins a customer address's fields into one display line. Shopify's
 * Admin API address object has no single pre-formatted string field
 * (that's storefront-only), so this builds one from the parts. */
function formatAddress(addr) {
  if (!addr) return null;
  const line = [addr.address1, addr.address2].filter(Boolean).join(", ");
  const cityLine = [addr.city, addr.province, addr.zip].filter(Boolean).join(", ");
  const full = [line, cityLine, addr.country].filter(Boolean).join(" — ");
  return full || null;
}

/** Builds a 4-step Placed -> Paid -> Shipped -> Delivered timeline from an
 * order's own fields plus its fulfillments' event history. A fulfillment's
 * `events` connection is what actually carries a "DELIVERED" status
 * (Fulfillment itself has no reliable deliveredAt on this API version) --
 * checked across every fulfillment in case there are multiple shipments. */
function buildOrderTimeline(order) {
  const fulfillments = order.fulfillments || [];
  const allEvents = fulfillments.flatMap((f) => (f.events?.edges || []).map((e) => e.node));
  const deliveredEvent = allEvents.find((e) => e.status === "DELIVERED");

  // "Shipped" comes from the order's own aggregate fulfillment status, not
  // just whether a fulfillment record exists -- a fulfillment can exist in
  // a pending/unsubmitted state without anything actually having shipped,
  // which was marking this step done too early.
  const shipped = ["FULFILLED", "PARTIALLY_FULFILLED"].includes(order.displayFulfillmentStatus);

  return [
    { label: "Placed", done: true, date: order.processedAt },
    { label: "Paid", done: order.displayFinancialStatus === "PAID", date: null },
    { label: "Shipped", done: shipped, date: null },
    { label: "Delivered", done: !!deliveredEvent, date: deliveredEvent?.happenedAt || null },
  ];
}

// Line-item properties that are either the internal pairing key or a raw
// variant-id lookup value, not something a customer typed in -- never shown.
// See CLAUDE.md "Architecture: the cart bundle system" -- same
// Linked Gemstone / _Linked Gemstone pairing property the cart drawer and
// cart page use, keyed by the root line's numeric variant id.
const HIDDEN_CUSTOMISATION_KEYS = new Set(["Linked Gemstone", "_Linked Gemstone", "Setting SKU"]);

/** Numeric id from a GID like "gid://shopify/ProductVariant/123" -- the
 * cart-side code stores the plain numeric variant id in the
 * "Linked Gemstone" property (via Liquid's `variant.id`), so this strips
 * the GID wrapper the Admin API returns to compare them. */
function numericIdFromGid(gid) {
  if (!gid) return null;
  const parts = String(gid).split("/");
  return parts[parts.length - 1] || null;
}

/** Regroups an order's flat line items back into gemstone + linked
 * "Gemstone Customisation" charge line pairs, mirroring the cart's own
 * bundle logic (see CLAUDE.md). A customisation line is identified by
 * carrying a "Linked Gemstone" property whose value is its paired root
 * line's variant id; every other line is treated as a root/standalone
 * line and matched against it. Orphaned customisation lines (no matching
 * root -- the legacy ₹1 utility-variant safety net firing) are dropped
 * rather than shown, since that path is documented as one that should
 * never actually occur. */
function buildOrderBundles(order) {
  const lines = (order.lineItems?.edges || []).map(({ node }) => node);

  const customisationByLinkedVariant = new Map();
  const rootLines = [];
  lines.forEach((line) => {
    const attrs = line.customAttributes || [];
    const linked = attrs.find((a) => a.key === "Linked Gemstone" || a.key === "_Linked Gemstone");
    if (linked && linked.value) {
      customisationByLinkedVariant.set(String(linked.value), line);
    } else {
      rootLines.push(line);
    }
  });

  return rootLines.map((line) => {
    const variantId = numericIdFromGid(line.variant?.id);
    const customisationLine = variantId ? customisationByLinkedVariant.get(variantId) : null;
    const customisation = customisationLine
      ? {
          properties: (customisationLine.customAttributes || [])
            .filter((a) => !HIDDEN_CUSTOMISATION_KEYS.has(a.key) && !a.key.startsWith("_"))
            .map((a) => ({ label: a.key, value: a.value })),
        }
      : null;
    return {
      title: line.title,
      quantity: line.quantity,
      image: line.image?.url || "",
      customisation,
    };
  });
}

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
    console.error("[customerAccountData] getFirstProductForCollections failed:", err);
    return {};
  }
}
