/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/customization-surcharge
 * (routed via [app_proxy] in shopify.app.toml, same signed-request pattern
 * as every other proxy.*.jsx route — Shopify signs every request that
 * reaches this URL through the proxy, and authenticate.public.appProxy()
 * verifies that signature, so this only ever runs for requests that
 * genuinely came through the customer's own store.)
 *
 * Turns an arbitrary rupee surcharge amount (a paid Lab Certification
 * upgrade, or a custom/uploaded design's setting cost) into ONE real,
 * correctly-priced Shopify variant, instead of the old approach of
 * charging `quantity = amount / ₹1` against a fixed ₹1 "Utility / Unit"
 * helper variant.
 *
 * That old approach was mathematically correct (₹1 × 132,000 units really
 * does total ₹1,32,000) but showed the customer a nonsensical-looking
 * "Quantity: 132000" at Shopify's own checkout, which isn't something the
 * theme can restyle (checkout isn't themed at all on a non-Plus plan) --
 * see shubh-gems-customizer.js's submitCustomizerBundle for the ₹1-unit
 * variant this replaces for CUSTOM/uploaded designs and paid
 * certification upgrades specifically. Catalog designs (a real pre-built
 * variant per Type/Metal/Design) are completely untouched by this --
 * they already have their own correctly-priced variant and never hit
 * this endpoint at all (their "leftover surcharge" is already zero).
 *
 * Reuses the exact same shared "Custom Jewelry Order" product +
 * createCustomizedVariant() this app already built (and battle-tested --
 * untracked inventory, storefront-cache-visibility wait, best-effort
 * gemstone photo) for a different, now-unused customizer flow
 * (proxy.jsx / shubh-jewelry-customizer-v2.js, since deleted) -- same
 * building block, new caller.
 *
 * Request body (JSON): { gemstoneVariantId, label, amount }
 *   amount is in rupees, e.g. 132000 for ₹1,32,000 -- the theme computes
 *   this exactly as it always has (metal rate × weight + making charge +
 *   tax, or the cert upgrade's own price); this endpoint's job is only to
 *   turn that already-computed number into a real variant, not to
 *   recompute pricing logic that lives in the theme.
 *
 * Response (JSON): { variantId }
 */
import { authenticate } from "../shopify.server";
import { getOrCreateCustomizationProduct, createCustomizedVariant } from "../utils/shopify-admin.server";

// Generous but bounded -- catches an obvious typo/tampering blowing the
// amount up by orders of magnitude (the exact failure mode the ₹1-unit
// variant itself was built to fix once already, see
// gemstoneCustomisationMatrix.server.js's own comment on that history)
// without needing to know every real design's actual price ceiling here.
const MAX_SANE_SURCHARGE_RUPEES = 5_00_00_000; // ₹5 crore

function toGid(resource, id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/${resource}/${id}`;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // Same "fail closed" reasoning as proxy.jsx / proxy.metal-rates.jsx.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gemstoneVariantId, label, amount } = body || {};
  const total = Number(amount);

  if (!gemstoneVariantId || !label) {
    return Response.json({ error: "gemstoneVariantId and label are required" }, { status: 400 });
  }
  if (!Number.isFinite(total) || total <= 0 || total > MAX_SANE_SURCHARGE_RUPEES) {
    return Response.json({ error: "amount must be a positive, sane rupee value" }, { status: 400 });
  }

  try {
    const gemstoneVariantGid = toGid("ProductVariant", gemstoneVariantId);

    // Best-effort lookup of the gemstone's own product + image, purely so
    // the new variant can carry a real photo instead of nothing --
    // attachGemstoneImage (inside createCustomizedVariant) already
    // tolerates either of these coming back blank, so a failure here
    // never blocks the actual surcharge-variant creation below.
    let gemstoneProductGid = null;
    let gemstoneImageUrl = null;
    try {
      const lookupRes = await admin.graphql(
        `#graphql
        query GemstoneForSurcharge($id: ID!) {
          productVariant(id: $id) {
            product { id featuredImage { url } }
          }
        }`,
        { variables: { id: gemstoneVariantGid } },
      );
      const lookupJson = await lookupRes.json();
      const product = lookupJson.data?.productVariant?.product;
      gemstoneProductGid = product?.id || null;
      gemstoneImageUrl = product?.featuredImage?.url || null;
    } catch (err) {
      console.error(`[proxy.customization-surcharge] gemstone lookup failed (non-fatal), shop=${session?.shop}:`, err);
    }

    const productGid = await getOrCreateCustomizationProduct(admin);
    const { numericId } = await createCustomizedVariant(admin, productGid, {
      title: label,
      total,
      gemstoneVariantGid,
      gemstoneProductGid,
      gemstoneImageUrl,
    });

    return Response.json({ variantId: numericId });
  } catch (err) {
    console.error(`[proxy.customization-surcharge] shop=${session?.shop} error:`, err);
    return Response.json({ error: "Failed to create surcharge variant" }, { status: 500 });
  }
};
