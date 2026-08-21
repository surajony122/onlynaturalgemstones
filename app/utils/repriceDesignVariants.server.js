/**
 * Shared logic for (re)pricing the "test" gemstone's Type+Metal+Design
 * variants. Used by both:
 *   - app/routes/app._index.jsx — the "Reprice" button in the app's own
 *     admin screen, the normal way to trigger this from now on.
 *   - app/routes/admin.migrate-design-variants.jsx — the original
 *     secret-URL route, kept as a fallback trigger.
 *
 * Price computed = stone's own price (read live off its "Loose" variant)
 * + the setting/design cost for that Type+Metal+Design combo (explicit
 * catalog price, or weight x (metal rate + making charge) when no
 * explicit price exists). This is a SNAPSHOT using whatever rates are in
 * config/settings_data.json at the moment this runs — not a live
 * formula — so re-run this whenever those rates change.
 */

import { getThemeSettings, getProductDesigns } from "./shopify-admin.server";
import { GLOBAL_DESIGNS, metalKeyFor } from "../data/globalDesigns.server";

export const PRODUCT_ID_NUMERIC = "10522275741995"; // "test" product
const THEME_GID = "gid://shopify/OnlineStoreTheme/190151065899"; // "product" theme

/** Rates/making-charge used to be hardcoded here, which is exactly the
 * bug that made "I set making charge to 0 in theme settings" have no
 * effect — this now reads config/settings_data.json live via the same
 * getThemeSettings() the original app pricing used, so a rate changed in
 * the theme customizer is what a Reprice click actually applies. */
async function fetchRatesFromTheme(admin) {
  const settings = await getThemeSettings(admin, THEME_GID);
  return {
    rates: {
      Silver: parseFloat(settings.shubh_rate_silver ?? 0),
      Panchdhatu: parseFloat(settings.shubh_rate_panchdhatu ?? 0),
      Copper: parseFloat(settings.shubh_rate_copper ?? 0),
      "22k Yellow Gold": parseFloat(settings.shubh_rate_gold_22k_y ?? 0),
      "18K Yellow Gold": parseFloat(settings.shubh_rate_gold_18k_y ?? 0),
      "18K White Gold": parseFloat(settings.shubh_rate_gold_18k_w ?? 0),
      "14K Yellow Gold": parseFloat(settings.shubh_rate_gold_14k_y ?? 0),
      "14K White Gold": parseFloat(settings.shubh_rate_gold_14k_w ?? 0),
    },
    makingChargePerGram: parseFloat(settings.shubh_making_charge ?? 0),
  };
}

const LOOSE_METALS = ["Silver", "Panchdhatu", "Copper", "22k Yellow Gold", "18K Yellow Gold", "14K Yellow Gold", "18K White Gold", "14K White Gold"];
// Every type EXCEPT pearl products — pearls don't come as bracelets at
// all (GLOBAL_DESIGNS.pearl has no "bracelet" key, only ring/pendant —
// see typesForDesignSet below, which is what actually decides this per
// product, not this constant directly).
const TYPES = ["Ring", "Bracelet", "Pendent"];

// Which Customised(Type) values a product gets depends on its design set
// (see designSetFor below) — pearls only ever come as Ring or Pendent,
// never Bracelet, matching GLOBAL_DESIGNS.pearl having no "bracelet" key
// at all (and the theme's own shubh-gems-global-designs.liquid, which
// this data was ported from, has the identical restriction).
function typesForDesignSet(designSet) {
  return designSet === "pearl" ? ["Ring", "Pendent"] : TYPES;
}

// Same signal the theme itself uses (snippets/shubh-jewelry-flow.liquid
// and shubh-gems-customizer.liquid both pass design_set: template.suffix
// into shubh-gems-global-designs.liquid) — a product's assigned JSON
// template suffix, not its title or tags. Pearl products use
// templates/product.pearl.json (suffix "pearl"); everything else uses
// the default product.json (no suffix), which maps to the "default"
// design bucket.
function designSetFor(templateSuffix) {
  return templateSuffix === "pearl" ? "pearl" : "default";
}

/** Product-specific designs first (this gemstone's own ring_designs /
 * pandent_designs / bracelet_designs metaobject — same mechanism the old
 * app used, see getProductDesigns), falling back to the shared global
 * catalog only when this product has nothing set for that Type+Metal —
 * exactly the priority the old Liquid customizer used. No gemstone has
 * its own designs set today, so this currently always falls through to
 * the global catalog — but it's wired up correctly for whenever one
 * does. designSet picks which global bucket ("default" or "pearl") to
 * fall back to — see designSetFor. */
async function resolveDesigns(admin, productGid, type, metal, designSet) {
  const typeLower = type.toLowerCase();
  const metalLower = metal.toLowerCase();
  const productSpecific = await getProductDesigns(admin, productGid, typeLower, metalLower);
  if (productSpecific.length > 0) return productSpecific;

  const typeKey = typeLower.includes("ring") ? "ring" : typeLower.includes("bracelet") ? "bracelet" : "pendant";
  const metalKey = metalKeyFor(metal);
  return GLOBAL_DESIGNS[designSet]?.[typeKey]?.[metalKey] || [];
}


async function computeVariants(admin, productGid, stonePrice, rates, makingChargePerGram, designSet) {
  const variants = [];
  const designValues = new Set(["N/A"]);
  const types = typesForDesignSet(designSet);

  for (const metal of LOOSE_METALS) {
    variants.push({ options: ["Loose", metal, "N/A"], price: stonePrice.toFixed(2) });
  }

  // One resolveDesigns() call per Type x Metal combo — each checks this
  // product's own metaobject designs first, falls back to the shared
  // catalog for this product's design set. Run in parallel since they're
  // independent reads.
  const combos = types.flatMap((type) => LOOSE_METALS.map((metal) => ({ type, metal })));
  const results = await Promise.all(combos.map(({ type, metal }) => resolveDesigns(admin, productGid, type, metal, designSet)));

  combos.forEach(({ type, metal }, i) => {
    for (const entry of results[i]) {
      let settingCost;
      if (entry.price) {
        settingCost = entry.price;
      } else if (entry.weight) {
        const rate = rates[metal] ?? 0;
        settingCost = entry.weight * (rate + makingChargePerGram);
      } else {
        continue;
      }
      const price = stonePrice + settingCost;
      designValues.add(entry.design);
      variants.push({
        options: [type, metal, entry.design],
        price: price.toFixed(2),
        image: entry.image,
      });
    }
  });
  return { variants, designValues: [...designValues] };
}

async function fetchStoneInfo(admin, productGid) {
  const res = await admin.graphql(
    `#graphql
    query GetStoneInfo($id: ID!) {
      product(id: $id) {
        templateSuffix
        variants(first: 250) {
          nodes { price selectedOptions { name value } }
        }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = await res.json();
  const product = json.data?.product;
  const nodes = product?.variants?.nodes || [];
  if (!nodes.length) throw new Error("Product has no variants at all");

  const designSet = designSetFor(product?.templateSuffix);

  const looseVariant = nodes.find((v) =>
    v.selectedOptions.some((o) => o.name === "Customised" && o.value === "Loose"),
  );
  if (looseVariant) return { price: parseFloat(looseVariant.price), designSet };

  // No "Customised: Loose" variant yet — this is a plain, not-yet-set-up
  // product (the common case when setting up jewelry variants on the rest
  // of the catalog for the first time). Its single/default variant price
  // IS the stone's own price; use that as the base to build the full
  // Ring/Bracelet/Pendant (or Ring/Pendant, for pearls) matrix on top of.
  return { price: parseFloat(nodes[0].price), designSet };
}

const CERT_UPGRADES = [
  { key: "GJI", price: 1000 },
  { key: "IGI", price: 1750 },
  { key: "GIA", price: 3500 },
];

/** Finds (or, on first use, creates) the shared "Certification Upgrade"
 * product — one real variant per paid upgrade (GJI/IGI/GIA), added to
 * cart as a second real line item only when a customer picks a paid
 * upgrade over their gemstone's free included certification. The free
 * cert never needs this — it's just a line-item property on the main
 * line, nothing to charge for. */
async function ensurePublishedOnlineStore(admin, productId) {
  const diag = { attempted: true };
  try {
    const pubRes = await admin.graphql(`#graphql
      query OnlineStorePublication { publications(first: 10) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    if (pubJson.errors) {
      diag.error = `publications query: ${JSON.stringify(pubJson.errors)}`;
      return diag;
    }
    const onlineStore = pubJson.data?.publications?.nodes?.find((p) => p.name === "Online Store");
    diag.foundOnlineStore = !!onlineStore;
    if (onlineStore) {
      const publishRes = await admin.graphql(
        `#graphql
        mutation PublishToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        { variables: { id: productId, input: [{ publicationId: onlineStore.id }] } },
      );
      const publishJson = await publishRes.json();
      diag.userErrors = publishJson.data?.publishablePublish?.userErrors || [];
      diag.graphqlErrors = publishJson.errors || null;
    }
  } catch (err) {
    diag.error = String(err.message || err);
    console.error("[ensurePublishedOnlineStore] failed (non-fatal):", err);
  }
  return diag;
}

export async function getOrCreateCertProduct(admin) {
  const findRes = await admin.graphql(
    `#graphql
    query FindCertProduct($query: String!) {
      products(first: 1, query: $query) { nodes { id } }
    }`,
    { variables: { query: "handle:certification-upgrade" } },
  );
  const findJson = await findRes.json();
  const existing = findJson.data?.products?.nodes?.[0];
  if (existing) {
    const publishDiagnostic = await ensurePublishedOnlineStore(admin, existing.id);
    return { productId: existing.id, publishDiagnostic };
  }

  const createRes = await admin.graphql(
    `#graphql
    mutation CreateCertProduct($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title: "Certification Upgrade",
          handle: "certification-upgrade",
          status: "ACTIVE",
          vendor: "Internal",
          tags: ["internal-do-not-list"],
          productOptions: [{ name: "Lab", position: 1, values: CERT_UPGRADES.map((c) => ({ name: c.key })) }],
          variants: CERT_UPGRADES.map((c) => ({
            optionValues: [{ optionName: "Lab", name: c.key }],
            price: c.price.toFixed(2),
            inventoryPolicy: "CONTINUE",
            inventoryItem: { tracked: false },
          })),
        },
      },
    },
  );
  const createJson = await createRes.json();
  const errs = createJson.data?.productSet?.userErrors;
  if (errs?.length) throw new Error(`Creating cert product failed: ${JSON.stringify(errs)}`);
  const productId = createJson.data?.productSet?.product?.id;

  // Publish to Online Store explicitly — same reason as the old
  // synthetic-variant approach: an unpublished product's variants get
  // rejected by /cart/add.js. Non-fatal: if this app's scopes don't
  // include write_publications yet, this fails without blocking getting
  // the variant IDs back — publish "Certification Upgrade" to Online
  // Store manually in Admin -> Products (one checkbox) until it lands.
  const publishDiagnostic = await ensurePublishedOnlineStore(admin, productId);
  return { productId, publishDiagnostic };
}

/** Returns { GJI: numericVariantId, IGI: ..., GIA: ... } for the theme
 * JS to embed directly — these are real, pre-existing, already-priced
 * variants, nothing created per-order. */
export async function getCertVariantIds(admin) {
  const { productId, publishDiagnostic } = await getOrCreateCertProduct(admin);
  const res = await admin.graphql(
    `#graphql
    query GetCertVariants($id: ID!) {
      product(id: $id) {
        variants(first: 10) { nodes { id selectedOptions { name value } } }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = await res.json();
  const nodes = json.data?.product?.variants?.nodes || [];
  const map = {};
  for (const v of nodes) {
    const lab = v.selectedOptions.find((o) => o.name === "Lab")?.value;
    if (lab) map[lab] = v.id.split("/").pop();
  }
  return { variantIds: map, publishDiagnostic };
}

// Same "has the jewelry customizer set up" test the storefront snippet
// itself uses (snippets/shubh-jewelry-flow.liquid: option name lowercased
// contains "custom" for Type, "metal" for Metal — Design isn't required
// there either, since that's the exact condition that decides whether the
// snippet renders the flow at all). Kept in sync by hand with that Liquid
// file if it ever changes.
function hasJewelrySetup(options) {
  const names = (options || []).map((o) => (o.name || "").toLowerCase());
  const hasType = names.some((n) => n.includes("custom"));
  const hasMetal = names.some((n) => n.includes("metal"));
  return hasType && hasMetal;
}

// Safety cap on how many products a single scan will page through — a
// runaway loop against a catalog with tens of thousands of products would
// otherwise tie up the request indefinitely. High enough to cover this
// store's realistic catalog size in one go; bump if it's ever hit.
const SCAN_PAGE_SIZE = 250;
const SCAN_MAX_PAGES = 40; // up to 10,000 products

/**
 * Pages through every product in the store (any status) and returns the
 * ones that DON'T have the Type(Customised)/Metal option structure the
 * jewelry customizer flow needs — i.e. products still needing setup
 * before repriceDesignVariants (or the storefront flow at all) can work
 * on them. Read-only, changes nothing.
 */
export async function findProductsMissingJewelrySetup(admin) {
  const missing = [];
  let scanned = 0;
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < SCAN_MAX_PAGES) {
    const res = await admin.graphql(
      `#graphql
      query ScanProductsForJewelrySetup($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            handle
            status
            options { name }
            collections(first: 10) { nodes { title } }
          }
        }
      }`,
      { variables: { first: SCAN_PAGE_SIZE, after: cursor } },
    );
    const json = await res.json();
    if (json.errors) throw new Error(`Product scan failed: ${JSON.stringify(json.errors).slice(0, 300)}`);

    const nodes = json.data?.products?.nodes || [];
    for (const p of nodes) {
      scanned++;
      if (!hasJewelrySetup(p.options)) {
        missing.push({
          id: p.id,
          numericId: p.id.split("/").pop(),
          title: p.title,
          handle: p.handle,
          status: p.status,
          collections: (p.collections?.nodes || []).map((c) => c.title),
        });
      }
    }

    hasNextPage = json.data?.products?.pageInfo?.hasNextPage || false;
    cursor = json.data?.products?.pageInfo?.endCursor || null;
    pages++;
  }

  return { scanned, missing, truncated: hasNextPage };
}

/**
 * Builds and pushes the full Customised(Loose/Ring/Bracelet/Pendent) x
 * Metals x Design variant matrix onto a single product via one
 * synchronous productSet call. Originally hardcoded to the "test"
 * product only (see PRODUCT_ID_NUMERIC below) — now takes any product
 * GID, so the same logic can set up the rest of the catalog too (see
 * setupJewelryVariantsForProducts). Callers that don't pass a productGid
 * keep the original "test" product behavior (used by both the
 * always-been-there "Reprice Design Variants" button and the legacy
 * admin.migrate-design-variants.jsx route — neither should suddenly
 * start targeting a different product).
 *
 * precomputedRates, if given, skips the theme-settings fetch entirely —
 * setupJewelryVariantsForProducts uses this to fetch rates ONCE for a
 * whole batch instead of once per product (was a real cause of the batch
 * "Apply" silently timing out: 20 products each redundantly re-fetching
 * the same theme settings, on top of everything else each one already
 * needs).
 */
export async function repriceDesignVariants(admin, productGid, precomputedRates) {
  const targetGid = productGid || `gid://shopify/Product/${PRODUCT_ID_NUMERIC}`;
  const [{ price: stonePrice, designSet }, { rates, makingChargePerGram }] = await Promise.all([
    fetchStoneInfo(admin, targetGid),
    precomputedRates ? Promise.resolve(precomputedRates) : fetchRatesFromTheme(admin),
  ]);
  const { variants, designValues } = await computeVariants(admin, targetGid, stonePrice, rates, makingChargePerGram, designSet);

  const input = {
    id: targetGid,
    productOptions: [
      { name: "Customised", position: 1, values: ["Loose", ...typesForDesignSet(designSet)].map((v) => ({ name: v })) },
      { name: "Metals", position: 2, values: LOOSE_METALS.map((v) => ({ name: v })) },
      { name: "Design", position: 3, values: designValues.map((v) => ({ name: v })) },
    ],
    variants: variants.map((v) => ({
      optionValues: v.options.map((value, i) => ({
        optionName: ["Customised", "Metals", "Design"][i],
        name: value,
      })),
      price: v.price,
      inventoryPolicy: "CONTINUE",
    })),
  };

  const res = await admin.graphql(
    `#graphql
    mutation SetProductVariants($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id title }
        userErrors { field message }
      }
    }`,
    { variables: { input } },
  );
  const json = await res.json();
  const userErrors = json.data?.productSet?.userErrors || [];
  if (userErrors.length) throw new Error(`productSet failed: ${JSON.stringify(userErrors)}`);

  return {
    stonePrice,
    designSet,
    variantCount: variants.length,
    designValueCount: designValues.length,
    ratesUsed: rates,
    makingChargePerGram,
  };
}

// One action call only ever processes this many products — keeps a single
// "Apply" click well inside typical request-timeout budgets even though
// each product needs several sequential GraphQL round trips (stone info,
// up to 24 parallel design lookups, then the productSet write itself).
// Was 20 — confirmed live that a 20-product batch made the whole "Apply"
// click silently time out with no error surfaced (500+ GraphQL calls in
// one request). Dropped to 5, plus rates are now fetched once for the
// whole batch (see below) instead of once per product, cutting per-batch
// GraphQL calls roughly in proportion. The caller (app._index.jsx)
// re-submits the remaining checked rows on the next click rather than
// this function ever looping unbounded.
export const SETUP_BATCH_SIZE = 5;

/**
 * Runs repriceDesignVariants for each given product GID, sequentially
 * (not in parallel — these are real, live-price-affecting writes, and
 * running them one at a time keeps GraphQL cost-throttling predictable
 * and keeps a single bad product from racing ahead of good ones in the
 * results). Never throws for a single product's failure — collects a
 * per-product result instead, so one bad product (e.g. one with zero
 * variants somehow) doesn't stop the rest of the batch.
 *
 * Fetches the theme's metal rates ONCE up front and reuses them for
 * every product in the batch (they're store-wide, not per-product) —
 * repriceDesignVariants used to fetch this itself on every single call,
 * meaning a batch of N products did N redundant identical theme-settings
 * queries for no reason.
 */
export async function setupJewelryVariantsForProducts(admin, productGids) {
  const rates = await fetchRatesFromTheme(admin);
  const results = [];
  for (const gid of productGids.slice(0, SETUP_BATCH_SIZE)) {
    try {
      const result = await repriceDesignVariants(admin, gid, rates);
      results.push({ productGid: gid, ok: true, ...result });
    } catch (err) {
      results.push({ productGid: gid, ok: false, error: String(err.message || err) });
    }
  }
  return { results, processed: results.length, skipped: Math.max(0, productGids.length - SETUP_BATCH_SIZE) };
}
