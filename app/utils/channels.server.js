/**
 * Shared "Online Store only" channel-publish logic — pulled out of
 * repriceDesignVariants.server.js into its own module so both that file
 * AND shopify-admin.server.js (getOrCreateCustomizationProduct, the
 * shared "Custom Jewelry Order" support product used by the coded/
 * dynamic design-set flow) can call it without creating a circular
 * import between the two.
 */

/** Publishes a product to the Online Store channel ONLY — explicitly
 * unpublishes it from every other installed sales channel (Google &
 * YouTube, Facebook & Instagram/Meta, Shop, etc.) rather than just
 * leaving them alone, since several of those channels auto-publish new
 * products by default; not touching them would mean a product could
 * silently show up on Meta/Google without anyone choosing that.
 * Non-fatal either way — a missing write_publications scope degrades to
 * "channels unchanged" rather than blocking whatever write triggered
 * this, same reasoning everywhere this gets called from. */
export async function ensureOnlineStoreOnly(admin, productId) {
  const diag = { attempted: true };
  try {
    const pubRes = await admin.graphql(`#graphql
      query AllPublications { publications(first: 25) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    if (pubJson.errors) {
      diag.error = `publications query: ${JSON.stringify(pubJson.errors)}`;
      return diag;
    }
    const allPubs = pubJson.data?.publications?.nodes || [];
    diag.allChannels = allPubs.map((p) => p.name);

    if (allPubs.length) {
      const publishRes = await admin.graphql(
        `#graphql
        mutation PublishToAll($id: ID!, $input: [PublicationInput!]!) {
          productUpdate(input: { id: $id, status: ACTIVE }) { product { id status } }
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        { variables: { id: productId, input: allPubs.map((p) => ({ publicationId: p.id })) } },
      );
      const publishJson = await publishRes.json();
      diag.publishUserErrors = publishJson.data?.publishablePublish?.userErrors || [];
      diag.publishGraphqlErrors = publishJson.errors || null;
    }
  } catch (err) {
    diag.error = String(err.message || err);
    console.error("[ensureOnlineStoreOnly] failed (non-fatal):", err);
  }
  return diag;
}
