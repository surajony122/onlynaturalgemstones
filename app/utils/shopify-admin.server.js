/**
 * Thin wrappers around the Admin GraphQL API for everything the trusted
 * pricing module needs to read. Every function here is READ-ONLY except
 * createCustomizedVariant/deleteVariant/adjustInventory (used elsewhere) —
 * nothing in this file ever writes a product's own price.
 */
import shopify from "../shopify.server";
import { ensureOnlineStoreOnly } from "./channels.server";

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
        product { id title featuredImage { url } }
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
    // Used to give the synthetic customization variant (see
    // createCustomizedVariant) the real gemstone's own image, so the
    // cart shows a real product photo instead of nothing.
    imageUrl: v.product.featuredImage?.url || null,
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

/** Lists every theme on the shop (any role — live, unpublished, backups
 * kept around under names like "backup 29-7", etc.), for the app's theme
 * inspector to let you pick a specific one instead of always reading
 * whatever's currently published. Read-only. */
export async function listThemes(admin) {
  const res = await admin.graphql(`#graphql
    query AllThemes {
      themes(first: 50) {
        nodes { id name role }
      }
    }`);
  const json = await res.json();
  if (json.errors) throw new Error(`Theme list failed: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data?.themes?.nodes || [];
}

/** Finds the currently-published (live/MAIN) theme's id — the one
 * actually serving the storefront right now, as opposed to any
 * unpublished "test" theme or the hardcoded THEME_GID some pricing code
 * reads settings from. Used only by the diagnostic below, to make sure
 * whatever we inspect matches what a real shopper sees. */
export async function findLiveThemeId(admin) {
  const res = await admin.graphql(`#graphql
    query LiveTheme {
      themes(first: 20, roles: [MAIN]) {
        nodes { id name role }
      }
    }`);
  const json = await res.json();
  if (json.errors) throw new Error(`Theme lookup failed: ${JSON.stringify(json.errors).slice(0, 300)}`);
  const nodes = json.data?.themes?.nodes || [];
  const live = nodes.find((t) => t.role === "MAIN") || nodes[0];
  if (!live) throw new Error("No published (MAIN) theme found on this shop");
  return { id: live.id, name: live.name };
}

/** Diagnostic only (not used by any live pricing/checkout path): lists
 * every theme file whose path looks related to the jewelry customizer
 * (contains "jewel", "custom", or "design"), and returns the raw content
 * of each match, truncated. Exists purely so this app can answer "is the
 * dynamic design-set customizer actually wired up on the live theme"
 * directly from real theme content instead of guessing from storefront
 * screenshots — see app._index.jsx's "Inspect storefront customizer"
 * button. Reading the full file list first (rather than guessing exact
 * filenames like getThemeSettings does for the one settings_data.json it
 * always needs) is deliberate: this app's own past comments reference
 * snippet names like shubh-jewelry-flow.liquid /
 * shubh-gems-global-designs.liquid, but those are notes from a previous
 * session, not a guarantee the current live theme still uses those exact
 * filenames. */
export async function inspectThemeCustomizerFiles(admin, themeGid) {
  const listRes = await admin.graphql(
    `#graphql
    query ListThemeFiles($id: ID!, $after: String) {
      theme(id: $id) {
        files(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { filename }
        }
      }
    }`,
    { variables: { id: themeGid, after: null } },
  );
  const listJson = await listRes.json();
  if (listJson.errors) throw new Error(`Theme file list failed: ${JSON.stringify(listJson.errors).slice(0, 300)}`);
  let allFiles = (listJson.data?.theme?.files?.nodes || []).map((f) => f.filename);
  let hasNextPage = listJson.data?.theme?.files?.pageInfo?.hasNextPage || false;
  let cursor = listJson.data?.theme?.files?.pageInfo?.endCursor || null;
  // Themes can have thousands of files (images, locales, etc.) — cap how
  // many pages we page through so this stays a quick diagnostic, not a
  // full theme crawl. 5 pages x 250 = 1250 files, comfortably covers a
  // normal theme's liquid/snippet/section file count.
  let pages = 1;
  while (hasNextPage && pages < 5) {
    const res = await admin.graphql(
      `#graphql
      query ListThemeFilesPage($id: ID!, $after: String) {
        theme(id: $id) {
          files(first: 250, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { filename }
          }
        }
      }`,
      { variables: { id: themeGid, after: cursor } },
    );
    const json = await res.json();
    if (json.errors) break;
    allFiles = allFiles.concat((json.data?.theme?.files?.nodes || []).map((f) => f.filename));
    hasNextPage = json.data?.theme?.files?.pageInfo?.hasNextPage || false;
    cursor = json.data?.theme?.files?.pageInfo?.endCursor || null;
    pages++;
  }

  // "custom" alone also matches Shopify's own templates/customers/*.json
  // (built-in customer-account pages — "custom" is just a substring of
  // "customers") and sections/custom-liquid.liquid (the generic "Custom
  // Liquid" section every theme ships) — exclude those explicitly rather
  // than widen the false-positive net further. "jewel"/"design" alone are
  // specific enough already not to need the same treatment.
  const candidates = allFiles.filter(
    (f) => /jewel|design/i.test(f) || (/custom/i.test(f) && !/customers\/|customer\.|custom-liquid|custom-search/i.test(f)),
  );
  // Prioritize the files that actually matter (the shubh-* jewelry/design
  // ones) to the front, so they're never crowded out of the 10-file
  // content-fetch cap by something less relevant that merely happened to
  // sort earlier.
  candidates.sort((a, b) => {
    const score = (f) => (/shubh-(jewelry|gems)/i.test(f) ? 0 : 1);
    return score(a) - score(b);
  });

  const contents = [];
  for (const filename of candidates.slice(0, 10)) {
    const res = await admin.graphql(
      `#graphql
      query ThemeFileContent($id: ID!, $filenames: [String!]!) {
        theme(id: $id) {
          files(filenames: $filenames, first: 1) {
            nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
          }
        }
      }`,
      { variables: { id: themeGid, filenames: [filename] } },
    );
    const json = await res.json();
    const content = json.data?.theme?.files?.nodes?.[0]?.body?.content || null;
    contents.push({ filename, length: content?.length ?? 0, excerpt: content ? content.slice(0, 3000) : null });
  }

  return { totalFilesScanned: allFiles.length, candidateCount: candidates.length, candidates, contents };
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
                fields {
                  key
                  value
                  reference {
                    ... on MediaImage {
                      image { url }
                    }
                  }
                }
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
  // Design images are a "file" reference field in the metaobject (not
  // plain text), same as the Liquid template's own
  // entry.design_image.value | ... | image_url fallback chain — resolve
  // via `reference.image.url` first, fall back to a plain-text `value`
  // in case a field is set up as a URL string instead of a file field.
  const fieldImage = (fields, keys) => {
    for (const k of keys) {
      const f = fields.find((x) => x.key === k);
      if (f?.reference?.image?.url) return f.reference.image.url;
      if (f && f.value) return f.value;
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
    const priceStr = fieldVal(fields, ["price"]);
    matches.push({
      design: fieldVal(fields, ["design_name", "design", "name", "title"]) || "",
      // Only set weight/price when the field actually has a value —
      // computeVariants treats "has an explicit price" vs "fall back to
      // weight-based calc" as mutually exclusive, same as the global
      // catalog entries do (see repriceDesignVariants.server.js).
      ...(priceStr ? { price: parseFloat(priceStr) } : { weight: parseFloat(fieldVal(fields, ["metal_weight", "weight", "estimated_weight"]) || "4.0") }),
      image: fieldImage(fields, ["design_image", "image", "photo"]) || "",
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

  // Publish to Online Store AND explicitly unpublish from every other
  // channel (Google & YouTube, Meta/Facebook, Shop, etc.) — `published:
  // true` on productCreate alone doesn't reliably do the former on every
  // API version, and an unpublished product's variants get rejected by
  // /cart/add.js, so the Online Store side is still required. The
  // unpublish-from-others side matters even more here than on an
  // ordinary product: this product accumulates one new one-off variant
  // per completed customization forever (see createCustomizedVariant), so
  // if it were ever left auto-subscribed to Google/Meta, every single one
  // of those throwaway variants would pile up there too — same failure
  // mode the native per-design variants had, just worse since this
  // product never stops growing. Non-fatal — logged, not thrown, same as
  // every other ensureOnlineStoreOnly call site.
  const publishDiagnostic = await ensureOnlineStoreOnly(admin, productId);
  if (!publishDiagnostic.foundOnlineStore || publishDiagnostic.error) {
    console.error("[getOrCreateCustomizationProduct] channel setup incomplete:", JSON.stringify(publishDiagnostic));
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
export async function createCustomizedVariant(admin, productGid, { title, total, gemstoneVariantGid, gemstoneProductGid, gemstoneImageUrl }) {
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

  // A variant that was JUST created via the Admin API isn't always visible
  // yet to the storefront's legacy /cart/add.js — confirmed live: even with
  // inventoryItem.tracked=false above, a cart/add.js call made immediately
  // after this mutation returns can still 422 "already sold out", because
  // that endpoint reads from a storefront cache that trails the Admin API's
  // write by a short, variable window. This isn't fixed by any variant
  // field — it's a replication delay, so the fix is to wait it out here
  // (once, server-side, before the client ever tries to add to cart)
  // rather than have every customer's browser discover it via a failed
  // add-to-cart. Polling availableForSale confirms the write has become
  // visible on Shopify's own read path at all; a fixed grace delay AFTER
  // that confirmation covers the separate storefront-cache hop that
  // availableForSale alone doesn't account for (confirmed live a second
  // time: the original version of this wait — floor-before-first-check
  // only, zero delay after confirming available — still let a real
  // "already sold out" 422 through on /cart/add.js, meaning the
  // storefront cache genuinely trails availableForSale becoming true, not
  // just the initial write).
  // Run the availability wait and the (best-effort, non-blocking-on-
  // failure) image linking concurrently — they touch independent
  // resources, no reason to make the customer wait for both in sequence.
  await Promise.all([
    waitUntilAvailableForSale(admin, variant.id),
    attachGemstoneImage(admin, productGid, gemstoneProductGid, variant.id, gemstoneImageUrl),
  ]);

  return { variantGid: variant.id, numericId: variant.id.split("/").pop() };
}

/** Best-effort: gives the newly created customization variant the real
 * gemstone's own photo, so the cart/order show an actual product image
 * instead of nothing — the shared "Custom Jewelry Order" product has no
 * single representative image of its own, since it stands in for every
 * gemstone's customizations.
 *
 * Caches the uploaded media's id on the GEMSTONE product itself
 * (custom.customization_media_id metafield) so the same photo isn't
 * re-uploaded onto "Custom Jewelry Order" every single time that
 * gemstone gets ordered — reuses the cached media id instead. Without
 * this, a popular gemstone's photo would get duplicated onto that shared
 * product's media library once per order, indefinitely.
 *
 * Never throws: a product image is a nice-to-have, not something that
 * should be able to block a purchase if anything here fails (missing
 * gemstoneProductGid/gemstoneImageUrl, a GraphQL error, a stale cached
 * media id that no longer exists — all just mean no image shows, same
 * as before this existed). */
async function attachGemstoneImage(admin, customizationProductGid, gemstoneProductGid, newVariantGid, gemstoneImageUrl) {
  if (!gemstoneProductGid) return;
  try {
    const cacheRes = await admin.graphql(
      `#graphql
      query CachedCustomizationMedia($id: ID!) {
        product(id: $id) {
          metafield(namespace: "custom", key: "customization_media_id") { value }
        }
      }`,
      { variables: { id: gemstoneProductGid } },
    );
    const cacheJson = await cacheRes.json();
    let mediaId = cacheJson.data?.product?.metafield?.value || null;

    if (!mediaId) {
      if (!gemstoneImageUrl) return;
      const createRes = await admin.graphql(
        `#graphql
        mutation CreateCustomizationMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id }
            mediaUserErrors { field message }
          }
        }`,
        {
          variables: {
            productId: customizationProductGid,
            media: [{ originalSource: gemstoneImageUrl, mediaContentType: "IMAGE" }],
          },
        },
      );
      const createJson = await createRes.json();
      const mediaErrs = createJson.data?.productCreateMedia?.mediaUserErrors;
      if (mediaErrs?.length) {
        console.error("[attachGemstoneImage] productCreateMedia failed:", JSON.stringify(mediaErrs));
        return;
      }
      mediaId = createJson.data?.productCreateMedia?.media?.[0]?.id;
      if (!mediaId) return;

      // Cache it on the gemstone product for next time — non-fatal if
      // this write fails, just means the next order re-uploads.
      await admin.graphql(
        `#graphql
        mutation CacheCustomizationMediaId($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { field message } }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId: gemstoneProductGid,
                namespace: "custom",
                key: "customization_media_id",
                type: "single_line_text_field",
                value: mediaId,
              },
            ],
          },
        },
      );
    }

    const appendRes = await admin.graphql(
      `#graphql
      mutation AppendCustomizationVariantMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId: customizationProductGid,
          variantMedia: [{ variantId: newVariantGid, mediaIds: [mediaId] }],
        },
      },
    );
    const appendJson = await appendRes.json();
    const appendErrs = appendJson.data?.productVariantAppendMedia?.userErrors;
    if (appendErrs?.length) {
      console.error("[attachGemstoneImage] productVariantAppendMedia failed:", JSON.stringify(appendErrs));
    }
  } catch (err) {
    console.error("[attachGemstoneImage] failed (non-fatal):", err);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilAvailableForSale(
  admin,
  variantGid,
  { attempts = 8, intervalMs = 500, floorMs = 1200, postConfirmGraceMs = 900 } = {},
) {
  for (let i = 0; i < attempts; i++) {
    await sleep(i === 0 ? floorMs : intervalMs);
    try {
      const res = await admin.graphql(
        `#graphql
        query CheckVariantAvailable($id: ID!) {
          productVariant(id: $id) { availableForSale }
        }`,
        { variables: { id: variantGid } },
      );
      const json = await res.json();
      if (json.data?.productVariant?.availableForSale) {
        // Confirmed on Shopify's own read path — still wait a bit longer
        // before telling the client to add to cart, since the storefront
        // cache /cart/add.js reads from has its own separate, slightly
        // longer lag (see the comment above this function's call site).
        await sleep(postConfirmGraceMs);
        return;
      }
    } catch (err) {
      // Availability-check failures shouldn't block the purchase — the
      // floor delay above already happened, so fall through and let the
      // customer's cart/add.js attempt be the real judge.
      console.error(`[waitUntilAvailableForSale] check failed for ${variantGid}:`, err);
    }
  }
  console.warn(`[waitUntilAvailableForSale] ${variantGid} still not confirmed available after waiting`);
}
