/**
 * Builds a REAL, pre-priced Metal x Design (x Size, for bracelets)
 * variant matrix on the three shared "Ring Settings" / "Pendant
 * Settings" / "Bracelet Settings" products — the same products the
 * dynamic customizer already uses for its Metal dropdown. This is what
 * replaces the old "create a fresh synthetic variant and wait for it to
 * become purchasable" flow (see createCustomizedVariant): once this
 * matrix exists, adding a customization to cart is a lookup of an
 * EXISTING variant, not a write + wait.
 *
 * Combines BOTH the "default" and "pearl" design catalogs into a single
 * matrix per type — confirmed by direct inspection of globalDesigns.
 * server.js that their design codes never collide (0 overlaps across
 * 274 catalog entries, once "Customised"/"Customized" is excluded — see
 * below), so there's no need for a third designSet dimension.
 *
 * Excludes the "Customised"/"Customized" catalog entries (customer
 * photo-upload designs) — same reasoning as shubh-jewelry-customizer-v2.
 * js: the price formula for those doesn't cleanly fit this per-combo
 * matrix approach yet.
 *
 * Prices are the SETTING/DESIGN cost only (weight x metal rate, or an
 * explicit design price) — NOT the gemstone's own price, since the
 * gemstone is its own separate, unmodified cart line. Uses the exact
 * same computeMetalCost/resolveMetalRate pricing.server.js's per-order
 * quote already uses, so a customer sees the identical number whether
 * it's computed live or read off this pre-built matrix.
 *
 * productSet (synchronous: true) is a full synchronizer — running this
 * REPLACES whatever variants these 3 products currently have (today,
 * Metal-only) with the new Metal x Design matrix. Nothing in the
 * currently-live purchase flow depends on the old Metal-only variant
 * ids persisting (they're only read for their title/price at quote time,
 * never stored) — but the storefront's OWN Liquid/JS that builds the
 * Metal dropdown from these products' variants needs to be updated to
 * match the new structure before this is safe to rely on end-to-end;
 * that's a separate, deliberately-sequenced next step, not bundled into
 * this function.
 */
import { getThemeSettings } from "./shopify-admin.server";
import { resolveMetalRate, computeMetalCost } from "./pricing.server";
import { GLOBAL_DESIGNS, metalKeyFor } from "../data/globalDesigns.server";
import { ensureOnlineStoreOnly } from "./channels.server";

const THEME_GID = "gid://shopify/OnlineStoreTheme/190151065899"; // "product" theme — same one repriceDesignVariants.server.js reads rates from for batch/admin-triggered jobs (not a live customer's own theme, since this isn't a per-order call)

const SETTINGS_PRODUCT_TITLES = {
  ring: "Ring Settings",
  pendant: "Pendant Settings",
  bracelet: "Bracelet Settings",
};

// Matches the live theme's shubh-jewelry-flow.liquid bracelet size list.
// Ring size is NOT a price dimension — confirmed by both the old theme
// JS and pricing.server.js, ring size is recorded but never affects cost.
const BRACELET_SIZES = ["5", "6", "7", "8", "9", "10"];

function isGoldOrSilverMetal(metalKey) {
  return metalKey === "silver" || metalKey.includes("yellow") || metalKey.includes("white");
}

async function findSettingsProduct(admin, title) {
  const res = await admin.graphql(
    `#graphql
    query FindSettingsProduct($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          options { name values }
        }
      }
    }`,
    { variables: { query: `title:'${title}'` } },
  );
  const json = await res.json();
  if (json.errors) throw new Error(`Product lookup failed: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data?.products?.nodes?.[0] || null;
}

export async function fetchSettingsProductsStatus(admin, customTitles = {}) {
  const titles = { ...SETTINGS_PRODUCT_TITLES, ...customTitles };
  const list = [];

  for (const [type, defaultTitle] of Object.entries(SETTINGS_PRODUCT_TITLES)) {
    const title = titles[type] || defaultTitle;
    try {
      const product = await findSettingsProduct(admin, title);
      if (!product) {
        list.push({ type, title, found: false, totalVariants: 0, metals: [] });
      } else {
        const metalOption = product.options.find((o) => o.name.toLowerCase().includes("metal"));
        list.push({
          type,
          title: product.title,
          id: product.id,
          found: true,
          totalVariants: product.totalVariants || 0,
          metals: metalOption ? metalOption.values : [],
        });
      }
    } catch (err) {
      list.push({ type, title, found: false, error: err.message, totalVariants: 0, metals: [] });
    }
  }

  return list;
}

/**
 * Runs the rebuild for selected Settings products.
 */
export async function buildSettingsDesignMatrix(admin, targets = null) {
  const settings = await getThemeSettings(admin, THEME_GID);
  const results = [];
  const entries = targets && typeof targets === "object" ? Object.entries(targets) : Object.entries(SETTINGS_PRODUCT_TITLES);

  for (const [type, title] of entries) {
    try {
      const product = await findSettingsProduct(admin, title);
      if (!product) {
        results.push({ type, title, ok: false, error: `Product titled "${title}" not found in your store` });
        continue;
      }

      const metalOption = product.options.find((o) => o.name.toLowerCase().includes("metal"));
      if (!metalOption) {
        results.push({ type, title, ok: false, error: `No Metal option found on "${title}" — nothing to build a Design matrix on top of` });
        continue;
      }
      const metalTitles = metalOption.values;
      const needsSize = type === "bracelet";

      const variantsInput = [];
      const designValuesSet = new Set();

      for (const metalTitle of metalTitles) {
        const metalKey = metalKeyFor(metalTitle);
        if (!metalKey) continue; // a metal value this app's key-detection doesn't recognize — skip rather than guess
        const isGoldOrSilver = isGoldOrSilverMetal(metalKey);
        const metalRate = resolveMetalRate(settings, metalKey);
        const seenDesigns = new Set();

        for (const catalog of [GLOBAL_DESIGNS.default, GLOBAL_DESIGNS.pearl]) {
          const list = (catalog[type] || {})[metalKey] || [];
          for (const entry of list) {
            if (/customis|customiz/i.test(entry.design)) continue;
            if (seenDesigns.has(entry.design)) continue; // defensive — confirmed 0 real collisions, but never trust that blindly
            seenDesigns.add(entry.design);
            designValuesSet.add(entry.design);

            const designWeight = parseFloat(entry.weight) || 0;
            const designPrice = parseFloat(entry.price) || 0;

            if (needsSize) {
              for (const size of BRACELET_SIZES) {
                // Mirrors the theme's own bracelet weight-scaling exactly:
                // weight *= size / 7 (7" is the baseline the catalog's
                // weight figures were written against).
                const scaledWeight = designWeight * (parseFloat(size) / 7);
                const cost = computeMetalCost({ isGoldOrSilver, designWeight: scaledWeight, designPrice, metalRate });
                variantsInput.push({ metalTitle, design: entry.design, size, price: cost });
              }
            } else {
              const cost = computeMetalCost({ isGoldOrSilver, designWeight, designPrice, metalRate });
              variantsInput.push({ metalTitle, design: entry.design, price: cost });
            }
          }
        }
      }

      if (!variantsInput.length) {
        results.push({ type, title, ok: false, error: "No design catalog entries found for this type across either design set" });
        continue;
      }

      const productOptions = [
        { name: metalOption.name, position: 1, values: metalTitles.map((v) => ({ name: v })) },
        { name: "Design", position: 2, values: [...designValuesSet].map((v) => ({ name: v })) },
      ];
      if (needsSize) {
        productOptions.push({ name: "Size", position: 3, values: BRACELET_SIZES.map((v) => ({ name: v })) });
      }

      const variants = variantsInput.map((v) => {
        const optionValues = [
          { optionName: metalOption.name, name: v.metalTitle },
          { optionName: "Design", name: v.design },
        ];
        if (needsSize) optionValues.push({ optionName: "Size", name: v.size });
        return {
          optionValues,
          price: v.price.toFixed(2),
          inventoryPolicy: "CONTINUE",
          // Untracked — same reasoning as createCustomizedVariant's own
          // untracked variants: these are reusable catalog entries, not
          // one-off stock to track. Real inventory tracking still lives
          // on the gemstone itself (its own single variant).
          inventoryItem: { tracked: false },
        };
      });

      const setRes = await admin.graphql(
        `#graphql
        mutation SetSettingsDesignVariants($input: ProductSetInput!) {
          productSet(input: $input, synchronous: true) {
            product { id }
            userErrors { field message }
          }
        }`,
        { variables: { input: { id: product.id, productOptions, variants } } },
      );
      const setJson = await setRes.json();
      const userErrors = setJson.data?.productSet?.userErrors;
      if (userErrors?.length) {
        results.push({ type, title, ok: false, error: `productSet failed: ${JSON.stringify(userErrors).slice(0, 500)}` });
        continue;
      }

      // Same Online-Store-only treatment as everywhere else this session
      // — these products should be purchasable via direct cart/add but
      // never listed on Google/Meta.
      const publishDiagnostic = await ensureOnlineStoreOnly(admin, product.id);

      results.push({ type, title, ok: true, variantCount: variants.length, publishDiagnostic });
    } catch (err) {
      results.push({ type, title, ok: false, error: String(err.message || err) });
    }
  }

  return { results };
}
