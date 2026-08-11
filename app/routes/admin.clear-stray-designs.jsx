/**
 * TEMPORARY cleanup route — "test" has 1 stray leftover design entry on
 * its own custom.ring_designs and custom.pandent_designs metaobject
 * fields (from earlier testing of the old system), which was correctly
 * but unintentionally overriding the global design catalog for
 * Ring/Silver and Pendent/Silver (dropping 16/8 designs down to 1).
 * Clears those two metafields on "test" so it falls through to the
 * shared global catalog like every other combo already does.
 * Delete this route once run.
 *
 *   GET /admin/clear-stray-designs?secret=<MIGRATION_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { PRODUCT_ID_NUMERIC } from "../utils/repriceDesignVariants.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== MIGRATION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ error: "No shop installed" }, { status: 500 });

  const { admin } = await shopify.unauthenticated.admin(session.shop);
  const productGid = `gid://shopify/Product/${PRODUCT_ID_NUMERIC}`;

  try {
    // Find the actual metafield ids to delete (namespace "custom").
    const findRes = await admin.graphql(
      `#graphql
      query FindStrayMetafields($id: ID!) {
        product(id: $id) {
          ring: metafield(namespace: "custom", key: "ring_designs") { id }
          pandent: metafield(namespace: "custom", key: "pandent_designs") { id }
          bracelet: metafield(namespace: "custom", key: "bracelet_designs") { id }
        }
      }`,
      { variables: { id: productGid } },
    );
    const findJson = await findRes.json();
    if (findJson.errors) {
      return Response.json({ ok: false, step: "find", errors: findJson.errors }, { status: 500 });
    }
    const fields = findJson.data?.product || {};
    const ids = [fields.ring?.id, fields.pandent?.id, fields.bracelet?.id].filter(Boolean);

    if (ids.length === 0) {
      return Response.json({ ok: true, message: "No stray metafields found, nothing to clear.", found: fields });
    }

    const results = [];
    for (const id of ids) {
      const delRes = await admin.graphql(
        `#graphql
        mutation DeleteStrayMetafield($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors { field message }
          }
        }`,
        { variables: { input: { id } } },
      );
      const delJson = await delRes.json();
      if (delJson.errors) {
        results.push({ id, errors: delJson.errors });
      } else {
        results.push({ id, result: delJson.data?.metafieldDelete });
      }
    }

    return Response.json({ ok: true, clearedIds: ids, results });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err?.message || err), stack: String(err?.stack || "") },
      { status: 500 },
    );
  }
};
