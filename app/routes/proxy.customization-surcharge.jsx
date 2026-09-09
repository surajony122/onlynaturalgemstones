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
 * correctly-priced variant on the SAME "Gemstone Customisation" product
 * every catalog design (RD11, RD21, ...) already lives on — instead of
 * the theme's old approach of charging
 * `quantity = amount / (whatever variant happened to be the fallback)`,
 * which was mathematically correct but showed the customer a
 * nonsensical-looking "Quantity: 132000" at Shopify's own checkout for a
 * genuine Rs 1,32,000 surcharge (confirmed live) — not fixable from the
 * theme side since checkout isn't themed at all without Shopify Plus +
 * Checkout UI Extensions. Catalog designs are completely untouched by
 * this — they already have their own correctly-priced variant
 * (getCustomisationVariant() in shubh-gems-customizer.js) and never hit
 * this endpoint at all.
 *
 * Request body (JSON): { gemstoneVariantId, type, metal, amount }
 *   amount is in rupees, e.g. 132000 for ₹1,32,000 -- the theme computes
 *   this exactly as it always has (metal rate × weight + making charge +
 *   tax); this endpoint's job is only to turn that already-computed
 *   number into a real variant, not to recompute pricing logic that
 *   lives in the theme.
 *
 * Response (JSON): { variantId }
 */
import { authenticate } from "../shopify.server";
import { createCustomSurchargeVariant } from "../utils/gemstoneCustomisationMatrix.server";

// Generous but bounded -- catches an obvious typo/tampering blowing the
// amount up by orders of magnitude (the exact failure mode the old
// fallback mechanism was itself already patched once for, see
// generateAllCustomisationVariants' own history) without needing to know
// every real design's actual price ceiling here.
const MAX_SANE_SURCHARGE_RUPEES = 5_00_00_000; // ₹5 crore

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // Same "fail closed" reasoning as proxy.metal-rates.jsx / proxy.places-autocomplete.jsx.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gemstoneVariantId, type, metal, amount } = body || {};
  const total = Number(amount);

  if (!gemstoneVariantId || !type || !metal) {
    return Response.json({ error: "gemstoneVariantId, type, and metal are required" }, { status: 400 });
  }
  if (!Number.isFinite(total) || total <= 0 || total > MAX_SANE_SURCHARGE_RUPEES) {
    return Response.json({ error: "amount must be a positive, sane rupee value" }, { status: 400 });
  }

  try {
    const { numericId } = await createCustomSurchargeVariant(admin, {
      type,
      metal,
      price: total,
      gemstoneVariantId,
    });
    return Response.json({ variantId: numericId });
  } catch (err) {
    console.error(`[proxy.customization-surcharge] shop=${session?.shop} error:`, err);
    return Response.json({ error: "Failed to create surcharge variant" }, { status: 500 });
  }
};
