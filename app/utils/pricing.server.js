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

  const gemstone = await getVariantPrice(admin, gemstoneVariantGid);
  const settings = await getThemeSettings(admin, themeGid);

  const isLoose = type === "loose" || !metalVariantGid;

  // --- Certification price ---
  const freeCertType = await getFreeCertType(admin, gemstone.productId);
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
  const metalVariant = await getVariantPrice(admin, metalVariantGid);
  const metalTitle = metalVariant.variantTitle;
  const metalTitleLower = metalTitle.toLowerCase();
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
  // straight to the flat-fallback branch below, same as the theme JS. ---
  let designWeight = 0;
  let designPrice = 0;
  if (!isCustomDesign) {
    const productMatches = await getProductDesigns(admin, gemstone.productId, type, metalTitleLower);
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
