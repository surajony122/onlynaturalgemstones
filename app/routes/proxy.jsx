/**
 * App Proxy endpoint: https://<store-domain>/apps/customize
 * (configured in shopify.app.toml under [app_proxy])
 *
 * This is the ONLY thing the storefront calls to turn a finished
 * customization into a single, correctly-priced cart line. Shopify signs
 * every request that reaches this URL through the proxy, and
 * authenticate.public.appProxy() verifies that signature — so this route
 * only ever runs for requests that genuinely came through the customer's
 * own store, not a random caller hitting the backend URL directly.
 *
 * Request body (JSON): selections only, never a price —
 * {
 *   gemstoneVariantId, type, metalVariantId, designCode, isCustomDesign,
 *   designSet, ringSize, certKey, poojaSelected
 * }
 *
 * Response (JSON): { variantId, total, breakdown }
 */
import { authenticate } from "../shopify.server";
import { computeTrustedQuote, QuoteError } from "../utils/pricing.server";
import { getOrCreateCustomizationProduct, createCustomizedVariant } from "../utils/shopify-admin.server";

function toGid(resource, id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/${resource}/${id}`;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // No stored offline session for this shop (app not installed, or
    // token revoked) — fail closed, never fall back to trusting the
    // request unauthenticated.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    themeId,
    gemstoneVariantId,
    type,
    metalVariantId,
    designCode,
    isCustomDesign,
    designSet,
    ringSize,
    certKey,
    poojaSelected,
  } = body || {};

  if (!themeId || !gemstoneVariantId || !type || !certKey) {
    return Response.json(
      { error: "themeId, gemstoneVariantId, type, and certKey are required" },
      { status: 400 },
    );
  }

  try {
    const quote = await computeTrustedQuote(admin, {
      themeGid: toGid("OnlineStoreTheme", themeId),
      gemstoneVariantGid: toGid("ProductVariant", gemstoneVariantId),
      type,
      metalVariantGid: metalVariantId ? toGid("ProductVariant", metalVariantId) : null,
      designCode,
      isCustomDesign: !!isCustomDesign,
      designSet,
      ringSize,
      certKey,
      poojaSelected: !!poojaSelected,
    });

    const productGid = await getOrCreateCustomizationProduct(admin);
    const variantTitle = `${quote.gemstoneProductTitle}${
      quote.breakdown.metalTitle ? " — " + quote.breakdown.metalTitle : ""
    }${designCode ? ", " + designCode : ""}${ringSize ? ", Size " + ringSize : ""}`;

    const { numericId } = await createCustomizedVariant(admin, productGid, {
      title: variantTitle,
      total: quote.breakdown.total,
      gemstoneVariantGid: toGid("ProductVariant", gemstoneVariantId),
    });

    return Response.json({
      variantId: numericId,
      total: quote.breakdown.total,
      breakdown: quote.breakdown,
    });
  } catch (err) {
    if (err instanceof QuoteError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error(`[proxy.customize] shop=${session?.shop} error:`, err);
    return Response.json({ error: "Failed to compute quote" }, { status: 500 });
  }
};
