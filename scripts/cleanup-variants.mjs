#!/usr/bin/env node
/**
 * Abandoned-variant cleanup. Meant to run on a schedule (Render Cron Job:
 * `node scripts/cleanup-variants.mjs`, e.g. once a day).
 *
 * Deletes customization variants (on the shared "Custom Jewelry Order"
 * product) older than RETENTION_HOURS that were never purchased. Safe to
 * delete blanket-by-age regardless of purchase status: Shopify orders keep
 * a snapshot of line item title/price/properties independent of whether
 * the underlying variant still exists, so deleting a variant after it's
 * been ordered does not affect that order's history — see
 * app/routes/webhooks.orders.create.jsx, which already reads what it
 * needs (the linked gemstone) at order-creation time, before this ever runs.
 *
 * Deliberately a standalone script (plain fetch + Prisma), not routed
 * through the Remix app's request-scoped shopify.server.js — this needs to
 * run unattended from a cron trigger, not an HTTP request.
 */
import { PrismaClient } from "@prisma/client";

const RETENTION_HOURS = 48;
const API_VERSION = "2026-10";

const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    console.log("No offline session found — app not installed anywhere yet. Nothing to clean up.");
    return;
  }
  const { shop, accessToken } = session;

  const productId = await findCustomizationProductId(shop, accessToken);
  if (!productId) {
    console.log("No 'Custom Jewelry Order' product exists yet — nothing to clean up.");
    return;
  }

  const variants = await fetchVariantsWithCreatedAt(shop, accessToken, productId);
  const cutoff = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;

  let deleted = 0;
  for (const v of variants) {
    if (!v.createdAt) continue; // The one default "Title" variant Shopify auto-creates has no metafield — leave it.
    const createdAtMs = new Date(v.createdAt).getTime();
    if (Number.isNaN(createdAtMs) || createdAtMs > cutoff) continue;
    await deleteVariant(shop, accessToken, productId, v.id);
    deleted++;
  }
  console.log(`Cleanup complete for ${shop}: deleted ${deleted} of ${variants.length} variant(s) checked.`);
}

async function adminGraphQL(shop, accessToken, query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Admin API HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Admin API errors: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

async function findCustomizationProductId(shop, accessToken) {
  const json = await adminGraphQL(
    shop,
    accessToken,
    `#graphql
    query FindCustomizationProduct($query: String!) {
      products(first: 1, query: $query) { nodes { id } }
    }`,
    { query: "handle:custom-jewelry-order" },
  );
  return json.data?.products?.nodes?.[0]?.id || null;
}

async function fetchVariantsWithCreatedAt(shop, accessToken, productId) {
  const json = await adminGraphQL(
    shop,
    accessToken,
    `#graphql
    query ProductVariants($id: ID!) {
      product(id: $id) {
        variants(first: 250) {
          nodes {
            id
            metafield(namespace: "custom", key: "customization_created_at") { value }
          }
        }
      }
    }`,
    { id: productId },
  );
  const nodes = json.data?.product?.variants?.nodes || [];
  return nodes.map((n) => ({ id: n.id, createdAt: n.metafield?.value || null }));
}

async function deleteVariant(shop, accessToken, productId, variantId) {
  const json = await adminGraphQL(
    shop,
    accessToken,
    `#graphql
    mutation DeleteVariant($productId: ID!, $id: ID!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: [$id]) {
        userErrors { field message }
      }
    }`,
    { productId, id: variantId },
  );
  const errs = json.data?.productVariantsBulkDelete?.userErrors;
  if (errs?.length) {
    console.error(`Failed to delete ${variantId}:`, errs);
  }
}

main()
  .catch((err) => {
    console.error("Cleanup script failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
