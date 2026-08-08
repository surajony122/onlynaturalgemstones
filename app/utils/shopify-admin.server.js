/**
 * Thin wrappers around the Admin GraphQL API for everything the trusted
 * pricing module needs to read. Every function here is READ-ONLY except
 * createCustomizedVariant/deleteVariant/adjustInventory (used elsewhere) —
 * nothing in this file ever writes a product's own price.
 */
import shopify from "../shopify.server";

/** Gets an authenticated Admin GraphQL client for a shop using its stored
 * offline access token — no interactive login needed, this runs for
 * unattended storefront requests. */
export async function adminClientFor(shop) {
  const { admin } = await shopify.unauthenticated.admin(shop);
  return admin;
}

/** Real, current price of a variant — always read fresh, never trusted
 * from client input. Used for the base gemstone price. */
export async function getVariantPrice(admin, variantGid) {
  const res = await admin.graphql(
    `#graphql
    query VariantPrice($id: ID!) {
      productVariant(id: $id) {
        id
        title
        price
        product { id title }
      }
    }`,
    { variables: { id: variantGid } },
  );
  const json = await res.json();
  const v = json.data?.productVariant;
  if (!v) throw new Error(`Variant not found: ${variantGid}`);
  return {
    variantId: v.id,
    variantTitle: v.title,
    price: parseFloat(v.price),
    productId: v.product.id,
    productTitle: v.product.title,
  };
}

/** Reads a theme's config/settings_data.json via the modern theme Files
 * GraphQL API and resolves the active preset, returning a flat settings
 * object exactly like what `settings.*` resolves to in Liquid. */
export async function getThemeSettings(admin, themeGid) {
  const res = await admin.graphql(
    `#graphql
    query ThemeSettings($id: ID!) {
      theme(id: $id) {
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
      }
    }`,
    { variables: { id: themeGid } },
  );
  const json = await res.json();
  const content = json.data?.theme?.files?.nodes?.[0]?.body?.content;
  if (!content) throw new Error(`Could not read settings_data.json for theme ${themeGid}`);
  // Shopify prepends an auto-generated-file warning comment
  // (/* ... */) to settings_data.json on some themes, the same way it
  // does to template JSON files — strip it before parsing, since plain
  // JSON.parse chokes on it.
  const withoutLeadingComment = content.replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, "");
  const parsed = JSON.parse(withoutLeadingComment);
  // settings_data.json's "current" is either the live settings object
  // directly, or a string naming a preset in "presets" — mirror Shopify's
  // own resolution so this matches what `settings.*` means in Liquid.
  if (typeof parsed.current === "string") {
    return parsed.presets?.[parsed.current] || {};
  }
  return parsed.current || {};
}

/** Resolves the product's free_certificate metaobject reference to a lab
 * name, then buckets it the same way the Liquid template does (iigj / igi
 * / gia / gji / other) so the "which cert is free for THIS gemstone" check
 * matches exactly. */
export async function getFreeCertType(admin, productGid) {
  const res = await admin.graphql(
    `#graphql
    query FreeCert($id: ID!) {
      product(id: $id) {
        metafield(namespace: "custom", key: "free_certificate") {
          reference {
            ... on Metaobject {
              fields { key value }
            }
          }
        }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = await res.json();
  const fields = json.data?.product?.metafield?.reference?.fields || [];
  const nameField = fields.find((f) => ["name", "title"].includes(f.key));
  const name = (nameField?.value || "GJI").toLowerCase();
  if (name.includes("iigj")) return "iigj";
  if (name.includes("igi")) return "igi";
  if (name.includes("gia")) return "gia";
  if (name.includes("gji")) return "gji";
  return "other";
}

/** Reads the product's own ring_designs/pandent_designs/bracelet_designs
 * metaobject list (product-specific design overrides) and returns entries
 * matching the chosen metal — same substring matching the Liquid uses.
 * Returns [] if the product has none, so the caller falls back to the
 * global design catalog exactly like the theme does. */
export async function getProductDesigns(admin, productGid, type, metalTitleLower) {
  const metafieldKey = type.includes("ring")
    ? "ring_designs"
    : type.includes("pend") || type.includes("pand")
      ? "pandent_designs"
      : type.includes("bracelet")
        ? "bracelet_designs"
        : null;
  if (!metafieldKey) return [];

  const res = await admin.graphql(
    `#graphql
    query ProductDesigns($id: ID!, $key: String!) {
      product(id: $id) {
        metafield(namespace: "custom", key: $key) {
          references(first: 100) {
            nodes {
              ... on Metaobject {
                fields { key value }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: productGid, key: metafieldKey } },
  );
  const json = await res.json();
  const nodes = json.data?.product?.metafield?.references?.nodes || [];

  const fieldVal = (fields, keys) => {
    for (const k of keys) {
      const f = fields.find((x) => x.key === k);
      if (f && f.value !== null && f.value !== "") return f.value;
    }
    return null;
  };

  const matches = [];
  for (const node of nodes) {
    const fields = node.fields || [];
    const entryMetal = (fieldVal(fields, ["metal_type", "metal"]) || "").toLowerCase();
    if (!entryMetal) continue;
    const matched =
      metalTitleLower === entryMetal ||
      metalTitleLower.includes(entryMetal) ||
      entryMetal.includes(metalTitleLower) ||
      (metalTitleLower.includes("18k") && entryMetal.includes("18k")) ||
      (metalTitleLower.includes("14k") && entryMetal.includes("14k")) ||
      (metalTitleLower.includes("22k") && entryMetal.includes("22k")) ||
      (metalTitleLower.includes("silver") && entryMetal.includes("silver")) ||
      (metalTitleLower.includes("panchdhatu") && entryMetal.includes("panchdhatu")) ||
      (metalTitleLower.includes("copper") && entryMetal.includes("copper")) ||
      (metalTitleLower.includes("tamba") && entryMetal.includes("tamba"));
    if (!matched) continue;
    matches.push({
      design: fieldVal(fields, ["design_name", "design", "name", "title"]) || "",
      weight: parseFloat(fieldVal(fields, ["metal_weight", "weight", "estimated_weight"]) || "4.0"),
      price: parseFloat(fieldVal(fields, ["price"]) || "0"),
    });
  }
  return matches;
}

const CUSTOMIZATION_PRODUCT_HANDLE = "custom-jewelry-order";

/** Finds (or, on first-ever use, creates) the single shared, unlisted
 * product that every customization variant gets created on. Not linked
 * from navigation/collections/search — customers only ever reach a
 * specific variant via the direct cart/add call this app makes, never by
 * browsing. Must be published to the Online Store channel, or
 * /cart/add.js rejects its variants from the storefront. */
export async function getOrCreateCustomizationProduct(admin) {
  const findRes = await admin.graphql(
    `#graphql
    query FindCustomizationProduct($query: String!) {
      products(first: 1, query: $query) {
        nodes { id }
      }
    }`,
    { variables: { query: `handle:${CUSTOMIZATION_PRODUCT_HANDLE}` } },
  );
  const findJson = await findRes.json();
  const existing = findJson.data?.products?.nodes?.[0];
  if (existing) return existing.id;

  const createRes = await admin.graphql(
    `#graphql
    mutation CreateCustomizationProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title: "Custom Jewelry Order",
          handle: CUSTOMIZATION_PRODUCT_HANDLE,
          status: "ACTIVE",
          published: true,
          vendor: "Internal",
          tags: ["internal-do-not-list"],
        },
      },
    },
  );
  const createJson = await createRes.json();
  const errs = createJson.data?.productCreate?.userErrors;
  if (errs?.length) throw new Error(`Creating customization product failed: ${JSON.stringify(errs)}`);
  const productId = createJson.data?.productCreate?.product?.id;

  // Publish explicitly to the Online Store channel — `published: true` on
  // productCreate alone doesn't reliably do this on every API version, and
  // an unpublished product's variants get rejected by /cart/add.js.
  const pubRes = await admin.graphql(
    `#graphql
    query OnlineStorePublication {
      publications(first: 10) {
        nodes { id name }
      }
    }`,
  );
  const pubJson = await pubRes.json();
  const onlineStore = pubJson.data?.publications?.nodes?.find((p) => p.name === "Online Store");
  if (onlineStore) {
    await admin.graphql(
      `#graphql
      mutation PublishToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
      { variables: { id: productId, input: [{ publicationId: onlineStore.id }] } },
    );
  }

  // Also remove the auto-created default variant later once a real one
  // exists — Shopify always creates one "Default Title" variant with the
  // product; leaving it around is harmless (never added to any cart) but
  // gets cleaned up by the abandoned-variant cron for tidiness.

  return productId;
}

/** Creates one new variant on the shared customization product, priced at
 * the server-computed total, titled descriptively, tagged with the
 * customization details for order visibility. This is the ONLY place a
 * price gets written — and it's always this module's own computed total,
 * never anything read from the incoming request body. */
export async function createCustomizedVariant(admin, productGid, { title, total, gemstoneVariantGid }) {
  const uniqueOptionValue = `${title} #${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await admin.graphql(
    `#graphql
    mutation CreateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id title }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        productId: productGid,
        variants: [
          {
            price: total.toFixed(2),
            optionValues: [{ optionName: "Title", name: uniqueOptionValue }],
            inventoryPolicy: "CONTINUE",
            // Untracked, not just "continue selling when out of stock" —
            // a tracked variant that's never been activated/stocked at a
            // location gets reported as sold out by /cart/add.js
            // regardless of inventoryPolicy (confirmed live: got a real
            // 422 "already sold out" error with tracked left at its
            // default). These are one-off virtual variants with nothing
            // to actually track, so untracked is correct anyway, not just
            // a workaround.
            inventoryItem: { tracked: false },
            metafields: [
              {
                namespace: "custom",
                key: "customization_created_at",
                type: "single_line_text_field",
                value: new Date().toISOString(),
              },
              {
                namespace: "custom",
                key: "customization_gemstone_variant",
                type: "single_line_text_field",
                value: gemstoneVariantGid,
              },
            ],
          },
        ],
      },
    },
  );
  const json = await res.json();
  const errs = json.data?.productVariantsBulkCreate?.userErrors;
  if (errs?.length) throw new Error(`Creating customized variant failed: ${JSON.stringify(errs)}`);
  const variant = json.data?.productVariantsBulkCreate?.productVariants?.[0];
  if (!variant) throw new Error("Variant creation returned no variant");
  return { variantGid: variant.id, numericId: variant.id.split("/").pop() };
}
