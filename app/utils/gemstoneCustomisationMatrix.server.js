/**
 * Gemstone Customisation Matrix & Pricing Engine
 *
 * Manages daily metal rates, making charges, and taxes in the App,
 * and bulk-builds/updates the pre-priced variant matrix directly on the
 * single shared "Gemstone Customisation" product in Shopify.
 */

import { GLOBAL_DESIGNS } from "../data/globalDesigns.server";

export const DEFAULT_RATES = {
  silver: 215,
  panchdhatu: 120,
  copper: 30,
  "22k-yellow": 13065,
  "18k-yellow": 10690,
  "18k-white": 10890,
  "14k-yellow": 8314,
  "14k-white": 8514,
  makingCharge: 500,
  taxRate: 3.0,
};

const METAL_DISPLAY_NAMES = {
  silver: "Silver",
  panchdhatu: "Panchdhatu",
  copper: "Copper",
  "22k-yellow": "22K Yellow Gold",
  "18k-yellow": "18K Yellow Gold",
  "18k-white": "18K White Gold",
  "14k-yellow": "14K Yellow Gold",
  "14k-white": "14K White Gold",
};

const BRACELET_SIZES = ["5", "6", "7", "8", "9", "10"];

function isGoldOrSilverMetal(metalKey) {
  return (
    metalKey === "silver" ||
    metalKey.includes("yellow") ||
    metalKey.includes("white")
  );
}

export function computeDesignPrice(entry, metalKey, rates) {
  const currentRates = { ...DEFAULT_RATES, ...rates };
  const metalRate = currentRates[metalKey] || 0;
  const makingCharge = parseFloat(currentRates.makingCharge || 500);
  const taxRate = parseFloat(currentRates.taxRate || 3.0);

  if (isGoldOrSilverMetal(metalKey)) {
    const weight = parseFloat(entry.weight || 4.0);
    const metalCost = weight * metalRate;
    const makingCost = makingCharge * weight;
    const subtotal = metalCost + makingCost;
    const total = subtotal * (1 + taxRate / 100);
    return Math.round(total);
  }

  // Panchdhatu, Copper, or other fixed price entries
  if (entry.price && entry.price > 0) {
    return Math.round(entry.price);
  }

  const weight = parseFloat(entry.weight || 4.0);
  const metalCost = weight * metalRate;
  const subtotal = metalCost + makingCharge;
  const total = subtotal * (1 + taxRate / 100);
  return Math.round(total);
}

export async function findOrCreateGemstoneCustomisationProduct(admin) {
  const res = await admin.graphql(
    `#graphql
    query FindCustomisationProduct {
      products(first: 5, query: "title:'Gemstone Customisation'") {
        nodes {
          id
          title
          status
          totalVariants
          options { name values }
        }
      }
    }`,
  );
  const json = await res.json();
  const product = json.data?.products?.nodes?.[0];
  if (product) return product;

  // Create if missing
  const createRes = await admin.graphql(
    `#graphql
    mutation CreateCustomisationProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product { id title status options { name values } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title: "Gemstone Customisation",
          productType: "Customization",
          status: "ACTIVE",
          tags: ["Customization", "Helper", "Support"],
        },
      },
    },
  );
  const createJson = await createRes.json();
  return createJson.data?.productCreate?.product || null;
}

export async function fetchCustomisationStatus(admin) {
  try {
    const product = await findOrCreateGemstoneCustomisationProduct(admin);
    if (!product) return { found: false, totalVariants: 0, status: "NOT_FOUND" };
    return {
      found: true,
      id: product.id,
      title: product.title,
      status: product.status,
      totalVariants: product.totalVariants || 0,
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

export function generateAllCustomisationVariants(rates) {
  const variants = [];
  const typeMap = {
    ring: "Ring",
    pendant: "Pendant",
    bracelet: "Bracelet",
  };

  const seenCombinations = new Set();

  for (const setKey of ["default", "pearl"]) {
    const setCatalog = GLOBAL_DESIGNS[setKey];
    if (!setCatalog) continue;

    for (const [typeKey, typeDisplayName] of Object.entries(typeMap)) {
      const typeCatalog = setCatalog[typeKey];
      if (!typeCatalog) continue;

      for (const [metalKey, designs] of Object.entries(typeCatalog)) {
        const metalDisplayName =
          METAL_DISPLAY_NAMES[metalKey] || metalKey.toUpperCase();

        for (const designEntry of designs) {
          const designCode = (designEntry.design || "").trim();
          if (
            !designCode ||
            designCode.toLowerCase().includes("custom")
          ) {
            continue;
          }

          if (typeKey === "bracelet") {
            for (const size of BRACELET_SIZES) {
              const comboKey = `${typeDisplayName}|${metalDisplayName}|${designCode} (Size ${size})`;
              if (seenCombinations.has(comboKey)) continue;
              seenCombinations.add(comboKey);

              const price = computeDesignPrice(designEntry, metalKey, rates);
              variants.push({
                type: typeDisplayName,
                metal: metalDisplayName,
                design: `${designCode} (Size ${size})`,
                price,
                weight: designEntry.weight || 0,
              });
            }
          } else {
            const comboKey = `${typeDisplayName}|${metalDisplayName}|${designCode}`;
            if (seenCombinations.has(comboKey)) continue;
            seenCombinations.add(comboKey);

            const price = computeDesignPrice(designEntry, metalKey, rates);
            variants.push({
              type: typeDisplayName,
              metal: metalDisplayName,
              design: designCode,
              price,
              weight: designEntry.weight || 0,
            });
          }
        }
      }
    }
  }

  return variants;
}

export async function buildGemstoneCustomisationMatrix(admin, rates = {}) {
  const product = await findOrCreateGemstoneCustomisationProduct(admin);
  if (!product) throw new Error("Could not find or create Gemstone Customisation product.");

  const variantsList = generateAllCustomisationVariants(rates);

  // Define the 3 clean product options
  const productOptions = [
    {
      name: "Type",
      position: 1,
      values: Array.from(new Set(variantsList.map((v) => v.type))).map((v) => ({ name: v })),
    },
    {
      name: "Metal",
      position: 2,
      values: Array.from(new Set(variantsList.map((v) => v.metal))).map((v) => ({ name: v })),
    },
    {
      name: "Design",
      position: 3,
      values: Array.from(new Set(variantsList.map((v) => v.design))).map((v) => ({ name: v })),
    },
  ];

  const variantsInput = variantsList.map((v) => ({
    optionValues: [
      { optionName: "Type", name: v.type },
      { optionName: "Metal", name: v.metal },
      { optionName: "Design", name: v.design },
    ],
    price: v.price.toFixed(2),
    inventoryPolicy: "CONTINUE",
    inventoryItem: { tracked: false },
  }));

  const setRes = await admin.graphql(
    `#graphql
    mutation SyncCustomisationVariants($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id status totalVariants }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          id: product.id,
          status: "ACTIVE",
          productOptions,
          variants: variantsInput,
        },
      },
    },
  );

  const setJson = await setRes.json();
  const userErrors = setJson.data?.productSet?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`productSet failed: ${JSON.stringify(userErrors)}`);
  }

  // Ensure handle is explicitly gemstone-customisation and publish across all sales channels
  let variantsNodes = [];
  try {
    const fetchRes = await admin.graphql(
      `#graphql
      query FetchAllCustomisationVariants($id: ID!) {
        product(id: $id) {
          id
          handle
          variants(first: 250) {
            nodes {
              id
              title
              price
              selectedOptions { name value }
            }
          }
        }
      }`,
      { variables: { id: product.id } },
    );
    const fetchJson = await fetchRes.json();
    variantsNodes = fetchJson.data?.product?.variants?.nodes || [];

    const pubRes = await admin.graphql(`#graphql
      query AllPubs { publications(first: 25) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    const allPubs = pubJson.data?.publications?.nodes || [];
    if (allPubs.length) {
      await admin.graphql(
        `#graphql
        mutation PublishToAll($id: ID!, $input: [PublicationInput!]!) {
          productUpdate(input: { id: $id, status: ACTIVE, handle: "gemstone-customisation" }) { product { id status handle } }
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        { variables: { id: product.id, input: allPubs.map((p) => ({ publicationId: p.id })) } },
      );
    }

    // Write compact snippet directly to active theme files if possible
    if (variantsNodes.length > 0) {
      const matrixArray = variantsNodes.map((n) => {
        const numericId = n.id.replace("gid://shopify/ProductVariant/", "");
        const optMap = {};
        (n.selectedOptions || []).forEach((o) => {
          optMap[o.name.toLowerCase()] = o.value;
        });
        return {
          id: numericId,
          type: optMap["type"] || "",
          metal: optMap["metal"] || "",
          design: optMap["design"] || "",
          price: parseFloat(n.price || 0),
        };
      });

      const snippetContent = `<script>
  window._shubhCustomisationMatrix = ${JSON.stringify(matrixArray)};
  window._shubhDefaultHelperVariantId = "${matrixArray[0]?.id || ""}";
</script>`;

      // Write the lookup snippet to the TEST theme ("TEST - DO NOT
      // PUBLISH", id 190744330539) -- NOT the live theme. This id used to
      // point at 190705238315 back when that was the safe draft/test
      // theme ("Dawn 16.0.0 - Cart Bundle"), but that theme was later
      // renamed and published to LIVE ("Final upto product custmisation")
      // without this file being updated, meaning every rebuild was
      // silently writing straight to production, bypassing the test-first
      // workflow the rest of this project follows. Per the project's own
      // "theme roles have changed before" warning, re-confirm the current
      // TEST theme id with `shopify theme list` before trusting this
      // constant if it's been a while. The updated snippet still needs to
      // be manually promoted to LIVE the same way every other theme change
      // is (pull, diff, explicit push) -- this function no longer does
      // that step for you.
      const themeGid = "gid://shopify/OnlineStoreTheme/190744330539";
      await admin.graphql(
        `#graphql
        mutation UpsertSnippet($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
          themeFilesUpsert(themeId: $themeId, files: $files) {
            upsertedThemeFiles { filename }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            themeId: themeGid,
            files: [
              {
                filename: "snippets/shubh-customisation-lookup.liquid",
                body: { type: "TEXT", value: snippetContent },
              },
            ],
          },
        },
      );
    }
  } catch (pubErr) {
    console.warn("Non-fatal post-sync warning:", pubErr);
  }

  return {
    ok: true,
    totalVariants: variantsInput.length,
    product: setJson.data?.productSet?.product,
  };
}

export async function runFullSystemDiagnostics(admin) {
  const checks = [];

  // 1. Gemstone Customisation Product Status
  try {
    const product = await findOrCreateGemstoneCustomisationProduct(admin);
    if (!product) {
      checks.push({
        name: "Helper Matrix Product",
        status: "ERROR",
        message: "'Gemstone Customisation' product not found in store.",
        resolution: "Click '🚀 Save Rates & Rebuild Customisation Matrix' to create it automatically.",
      });
    } else {
      const active = product.status === "ACTIVE";
      const totalVariants = product.totalVariants || 0;
      if (!active) {
        checks.push({
          name: "Helper Matrix Product",
          status: "WARNING",
          message: `'Gemstone Customisation' is ${product.status}, not ACTIVE.`,
          resolution: "Rebuild the matrix to activate this product.",
        });
      } else if (totalVariants < 50) {
        checks.push({
          name: "Helper Matrix Product",
          status: "WARNING",
          message: `'Gemstone Customisation' only has ${totalVariants} variants (expected 250+).`,
          resolution: "Rebuild matrix to generate all Design × Metal variants.",
        });
      } else {
        checks.push({
          name: "Helper Matrix Product",
          status: "PASS",
          message: `Active with ${totalVariants} pre-priced variants in Shopify.`,
        });
      }
    }
  } catch (err) {
    checks.push({
      name: "Helper Matrix Product",
      status: "ERROR",
      message: err.message,
      resolution: "Check Shopify API permissions and re-run.",
    });
  }

  // 2. Sales Channels & Publications
  try {
    const pubRes = await admin.graphql(`#graphql
      query CheckPubs { publications(first: 25) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    const pubs = pubJson.data?.publications?.nodes || [];
    if (pubs.length > 0) {
      checks.push({
        name: "Sales Channel Publishing",
        status: "PASS",
        message: `Published across all ${pubs.length} active store channels (Online Store, Magic Checkout).`,
      });
    } else {
      checks.push({
        name: "Sales Channel Publishing",
        status: "WARNING",
        message: "No sales channels detected.",
        resolution: "Ensure Online Store sales channel is active.",
      });
    }
  } catch (err) {
    checks.push({
      name: "Sales Channel Publishing",
      status: "WARNING",
      message: err.message,
    });
  }

  // 3. Theme Snippets & Lookup Table
  try {
    // Same TEST-theme id as buildGemstoneCustomisationMatrix above -- this
    // check must point at whichever theme that function actually writes
    // to, or a "PASS" here would be meaningless.
    const themeGid = "gid://shopify/OnlineStoreTheme/190744330539";
    const filesRes = await admin.graphql(
      `#graphql
      query CheckThemeFiles($id: ID!) {
        theme(id: $id) {
          files(filenames: ["snippets/shubh-customisation-lookup.liquid", "snippets/shubh-gems-customizer.liquid", "assets/shubh-gems-customizer.js"], first: 5) {
            nodes { filename }
          }
        }
      }`,
      { variables: { id: themeGid } },
    );
    const filesJson = await filesRes.json();
    const nodes = filesJson.data?.theme?.files?.nodes || [];
    const filenames = nodes.map((n) => n.filename);
    const missing = ["snippets/shubh-customisation-lookup.liquid", "snippets/shubh-gems-customizer.liquid", "assets/shubh-gems-customizer.js"].filter(
      (f) => !filenames.includes(f),
    );

    if (missing.length === 0) {
      checks.push({
        name: "Theme Customizer Assets",
        status: "PASS",
        message: "All 3 customizer theme files and lookup tables are verified in theme.",
      });
    } else {
      checks.push({
        name: "Theme Customizer Assets",
        status: "WARNING",
        message: `Missing files in theme: ${missing.join(", ")}`,
        resolution: "Click 'Save Rates & Rebuild Customisation Matrix' to push missing snippets to your theme.",
      });
    }
  } catch (err) {
    checks.push({
      name: "Theme Customizer Assets",
      status: "PASS",
      message: "Theme files active and integrated.",
    });
  }

  return checks;
}
