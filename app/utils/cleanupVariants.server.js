/**
 * Shared abandoned-variant cleanup logic — deletes customization variants
 * (on the shared "Custom Jewelry Order" product) older than RETENTION_HOURS
 * that were never purchased. Safe to delete blanket-by-age regardless of
 * purchase status: Shopify orders keep a snapshot of line item
 * title/price/properties independent of whether the underlying variant
 * still exists — see app/routes/webhooks.orders.create.jsx, which already
 * reads what it needs (the linked gemstone) at order-creation time, well
 * before this ever runs.
 *
 * Called from app/routes/cron.cleanup.jsx, hit by a free external
 * scheduler (see DEPLOYMENT.md) — avoids needing a paid Render Cron Job
 * service for something this cheap to run.
 */

const RETENTION_HOURS = 48;

export async function cleanupAbandonedVariants(admin) {
  const findRes = await admin.graphql(
    `#graphql
    query FindCustomizationProduct($query: String!) {
      products(first: 1, query: $query) { nodes { id } }
    }`,
    { variables: { query: "handle:custom-jewelry-order" } },
  );
  const findJson = await findRes.json();
  const productId = findJson.data?.products?.nodes?.[0]?.id;
  if (!productId) {
    return { deleted: 0, checked: 0, note: "No 'Custom Jewelry Order' product exists yet." };
  }

  const variantsRes = await admin.graphql(
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
    { variables: { id: productId } },
  );
  const variantsJson = await variantsRes.json();
  const nodes = variantsJson.data?.product?.variants?.nodes || [];

  const cutoff = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;
  let deleted = 0;

  for (const v of nodes) {
    const createdAt = v.metafield?.value;
    if (!createdAt) continue; // The auto-created default "Title" variant has no metafield — leave it.
    const createdAtMs = new Date(createdAt).getTime();
    if (Number.isNaN(createdAtMs) || createdAtMs > cutoff) continue;

    const delRes = await admin.graphql(
      `#graphql
      mutation DeleteVariant($productId: ID!, $id: ID!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: [$id]) {
          userErrors { field message }
        }
      }`,
      { variables: { productId, id: v.id } },
    );
    const delJson = await delRes.json();
    const errs = delJson.data?.productVariantsBulkDelete?.userErrors;
    if (errs?.length) {
      console.error(`[cleanupAbandonedVariants] failed to delete ${v.id}:`, errs);
    } else {
      deleted++;
    }
  }

  return { deleted, checked: nodes.length };
}
