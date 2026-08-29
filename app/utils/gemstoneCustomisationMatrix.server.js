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

  // Ensure published across all channels including Razorpay Magic Checkout
  try {
    const pubRes = await admin.graphql(`#graphql
      query AllPubs { publications(first: 25) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    const allPubs = pubJson.data?.publications?.nodes || [];
    if (allPubs.length) {
      await admin.graphql(
        `#graphql
        mutation PublishToAll($id: ID!, $input: [PublicationInput!]!) {
          productUpdate(input: { id: $id, status: ACTIVE }) { product { id status } }
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        { variables: { id: product.id, input: allPubs.map((p) => ({ publicationId: p.id })) } },
      );
    }
  } catch (pubErr) {
    console.warn("Non-fatal channel publish warning:", pubErr);
  }

  return {
    ok: true,
    totalVariants: variantsInput.length,
    product: setJson.data?.productSet?.product,
  };
}
