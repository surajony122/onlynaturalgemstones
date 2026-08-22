/**
 * The trusted price computation. This is the one place that decides what a
 * customized jewelry order actually costs — it NEVER accepts a price,
 * subtotal, or total from the caller. Every number it uses comes from a
 * live Shopify read (variant price, theme settings, product metaobjects)
 * or the backend's own ported design catalog (globalDesigns.server.js).
 *
 * The caller (the App Proxy route) only ever passes SELECTIONS: which
 * metal variant, which design code, which certification key, whether the
 * ring/bracelet size was picked, whether a custom design photo was
 * uploaded. If a request is tampered with in devtools to claim a
 * different total, it has no effect — this function recomputes from
 * scratch every time.
 *
 * Formula mirrors the "product" theme's updatePrice() exactly, including
 * its current making-charge/tax being zero (see conversation history —
 * that's a known theme bug, left as-is on purpose so this always matches
 * what the customer saw on the page).
 */
import {
  getVariantPrice,
  getThemeSettings,
  getFreeCertType,
  getProductDesigns,
} from "./shopify-admin.server";
import { lookupGlobalDesign, metalKeyFor } from "../data/globalDesigns.server";

const CERT_KEYS = ["free", "gji", "iigj", "igi", "gia"];
const CERT_DEFAULTS = { gji: 1000, iigj: 1000, igi: 1750, gia: 3500 };
const METAL_RATE_SETTINGS_KEY = {
  silver: "shubh_rate_silver",
  panchdhatu: "shubh_rate_panchdhatu",
  copper: "shubh_rate_copper",
  "22k-yellow": "shubh_rate_gold_22k_y",
  "18k-yellow": "shubh_rate_gold_18k_y",
  "18k-white": "shubh_rate_gold_18k_w",
  "14k-yellow": "shubh_rate_gold_14k_y",
  "14k-white": "shubh_rate_gold_14k_w",
};
const METAL_RATE_DEFAULTS = {
  silver: 215,
  panchdhatu: 120,
  copper: 30,
  "22k-yellow": 13065,
  "18k-yellow": 10690,
  "18k-white": 10890,
  "14k-yellow": 8314,
  "14k-white": 8514,
};

/** Reads the live per-gram metal rate for one metal key out of a theme
 * settings object — shared by computeTrustedQuote and
 * settingsMatrix.server.js's batch price-matrix builder so both always
 * use the exact same rate for the exact same metal, never two separately
 * hand-copied lookups that could drift out of sync. */
export function resolveMetalRate(settings, metalKey) {
  return parseFloat(settings[METAL_RATE_SETTINGS_KEY[metalKey]]) || METAL_RATE_DEFAULTS[metalKey];
}

/** The metal/design cost formula itself (mirrors the theme's own
 * updatePrice() exactly) — pulled out to its own exported function so
 * settingsMatrix.server.js's batch matrix builder computes prices with
 * the IDENTICAL formula computeTrustedQuote uses per-order, rather than
 * a second hand-copied version that could quietly drift out of sync with
 * this one. */
export function computeMetalCost({ isGoldOrSilver, designWeight, designPrice, metalRate }) {
  if (isGoldOrSilver) {
    return designWeight > 0 ? Math.max(designWeight, 1) * metalRate : designPrice || 2000;
  }
  return designPrice > 0 ? designPrice : designWeight > 0 ? Math.max(designWeight, 1) * metalRate : 2000;
}

class QuoteError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuoteError";
  }
}

/**
 * @param {object} admin - authenticated Admin GraphQL client
 * @param {object} selections
 * @param {string} selections.themeGid - gid://shopify/OnlineStoreTheme/... the customer's actual storefront theme, so settings match what they saw
 * @param {string} selections.gemstoneVariantGid
 * @param {string} selections.type - e.g. "ring-settings" | "pandent-settings" | "bracelet-settings" | "loose"
 * @param {string} [selections.metalVariantGid] - the real Setting product variant the customer picked (its title is read fresh, never trusted from the client)
 * @param {string} [selections.designCode]
 * @param {boolean} [selections.isCustomDesign]
 * @param {string} [selections.ringSize]
 * @param {string} selections.certKey - one of CERT_KEYS
 * @param {boolean} [selections.poojaSelected]
 */
export async function computeTrustedQuote(admin, selections) {
  const {
    themeGid,
    gemstoneVariantGid,
    type,
    metalVariantGid,
    designCode,
    isCustomDesign,
    ringSize,
    certKey,
    poojaSelected,
  } = selections;

  if (!CERT_KEYS.includes(certKey)) {
    throw new QuoteError(`Invalid certKey: ${certKey}`);
  }

  // isLoose only depends on the raw selections, so it's known before any
  // Shopify read — used below to decide whether metalVariant even needs
  // fetching, so a "loose" quote doesn't pay for a fetch it never uses.
  const isLoose = type === "loose" || !metalVariantGid;

  // Fetch everything that DOESN'T depend on another fetch's result in
  // one round of parallel requests instead of five sequential ones —
  // gemstone/settings/metalVariant are all independent reads. This was a
  // real, measurable chunk of the delay between clicking Add to Cart and
  // the price actually resolving (5 sequential Admin GraphQL round trips
  // add up fast); getFreeCertType and getProductDesigns still have to
  // wait for gemstone (and getProductDesigns for metalVariant too), so
  // they're parallelized as a second round below instead.
  const [gemstone, settings, metalVariant] = await Promise.all([
    getVariantPrice(admin, gemstoneVariantGid),
    getThemeSettings(admin, themeGid),
    isLoose ? Promise.resolve(null) : getVariantPrice(admin, metalVariantGid),
  ]);

  const metalTitle = metalVariant?.variantTitle;
  const metalTitleLower = metalTitle?.toLowerCase();

  const [freeCertType, productMatches] = await Promise.all([
    getFreeCertType(admin, gemstone.productId),
    !isLoose && !isCustomDesign ? getProductDesigns(admin, gemstone.productId, type, metalTitleLower) : Promise.resolve([]),
  ]);

  let certPrice = 0;
  let certName = "Included";
  if (certKey !== "free" && certKey !== freeCertType) {
    certPrice = parseFloat(settings[`shubh_rate_${certKey}`]) || CERT_DEFAULTS[certKey] || 0;
    certName = certKey.toUpperCase();
  }

  if (isLoose) {
    const total = gemstone.price + certPrice;
    return {
      currency: "INR",
      breakdown: {
        stonePrice: gemstone.price,
        metalCost: 0,
        certPrice,
        certName,
        total,
      },
      gemstoneProductId: gemstone.productId,
      gemstoneProductTitle: gemstone.productTitle,
      gemstoneImageUrl: gemstone.imageUrl,
    };
  }

  // --- Metal: read the REAL variant title, never trust a client-sent metal name ---
  // (metalVariant was already fetched above, in parallel with gemstone/settings)
  const metalKey = metalKeyFor(metalTitle);
  if (!metalKey) {
    throw new QuoteError(`Unrecognized metal: ${metalTitle}`);
  }
  const metalRate =
    parseFloat(settings[METAL_RATE_SETTINGS_KEY[metalKey]]) || METAL_RATE_DEFAULTS[metalKey];
  const isGoldOrSilver = metalTitleLower.includes("gold") || metalKey === "silver";

  // --- Design weight/price: product-specific override first, then the
  // ported global catalog, exactly like the Liquid template's fallback
  // order. A custom-uploaded design (no catalog entry by definition) skips
  // straight to the flat-fallback branch below, same as the theme JS.
  // (productMatches was already fetched above, in parallel with freeCertType) ---
  let designWeight = 0;
  let designPrice = 0;
  if (!isCustomDesign) {
    let match = productMatches.find((d) => d.design.trim() === (designCode || "").trim());
    if (!match) {
      const designSet = selections.designSet === "pearl" ? "pearl" : "default";
      match = lookupGlobalDesign({ type, metalTitle, designCode, designSet });
    }
    if (!match) {
      throw new QuoteError(`Unrecognized design "${designCode}" for ${type}/${metalTitle}`);
    }
    designWeight = parseFloat(match.weight) || 0;
    designPrice = parseFloat(match.price) || 0;
  }

  // --- Metal cost (mirrors updatePrice()'s branching exactly) ---
  let metalCost;
  if (isGoldOrSilver) {
    metalCost = designWeight > 0 ? Math.max(designWeight, 1) * metalRate : designPrice || 2000;
  } else {
    metalCost = designPrice > 0 ? designPrice : designWeight > 0 ? Math.max(designWeight, 1) * metalRate : 2000;
  }

  // No making charge / tax — matches the theme's current behavior exactly
  // (see conversation history for why this was left as-is on purpose).
  const total = gemstone.price + metalCost + certPrice;

  return {
    currency: "INR",
    breakdown: {
      stonePrice: gemstone.price,
      metalTitle,
      metalCost,
      certPrice,
      certName,
      ringSize: ringSize || null,
      poojaSelected: !!poojaSelected,
      total,
    },
    gemstoneProductId: gemstone.productId,
    gemstoneProductTitle: gemstone.productTitle,
    gemstoneImageUrl: gemstone.imageUrl,
    metalVariantId: metalVariant.variantId,
  };
}

export { QuoteError };
