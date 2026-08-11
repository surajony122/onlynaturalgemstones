/**
 * TEMPORARY one-time fix — Yellow Sapphire's FAQ tab (custom.tab_10_content)
 * uses <h4> for its question headings; every other collection tab (and
 * Blue Sapphire specifically, per user's ask) uses <h3>. Replaces h4 with
 * h3 for that field's question headings only. Delete once run.
 *
 *   GET /admin/fix-faq-heading?secret=<MIGRATION_SECRET>&handle=yellow-sapphire&key=tab_10_content
 */
import shopify from "../shopify.server";
import db from "../db.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== MIGRATION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ error: "No shop installed" }, { status: 500 });

  const { admin } = await shopify.unauthenticated.admin(session.shop);
  const handle = url.searchParams.get("handle") || "yellow-sapphire";
  const key = url.searchParams.get("key") || "tab_10_content";

  try {
    const findRes = await admin.graphql(
      `#graphql
      query FindCollectionAndField($handle: String!, $key: String!) {
        collectionByHandle(handle: $handle) {
          id
          metafield(namespace: "custom", key: $key) {
            id
            type
            value
          }
        }
      }`,
      { variables: { handle, key } },
    );
    const findJson = await findRes.json();
    if (findJson.errors) return Response.json({ ok: false, errors: findJson.errors }, { status: 500 });

    const collection = findJson.data?.collectionByHandle;
    const metafield = collection?.metafield;
    if (!collection || !metafield) {
      return Response.json({ ok: false, error: "Collection or field not found" }, { status: 404 });
    }

    const before = metafield.value;
    const after = before.replace(/<h4(\s|>)/g, "<h3$1").replace(/<\/h4>/g, "</h3>");

    if (before === after) {
      return Response.json({ ok: true, message: "No <h4> found, nothing to change." });
    }

    const setRes = await admin.graphql(
      `#graphql
      mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: collection.id,
              namespace: "custom",
              key,
              type: metafield.type,
              value: after,
            },
          ],
        },
      },
    );
    const setJson = await setRes.json();
    if (setJson.errors) return Response.json({ ok: false, errors: setJson.errors }, { status: 500 });
    const userErrors = setJson.data?.metafieldsSet?.userErrors;
    if (userErrors?.length) return Response.json({ ok: false, userErrors }, { status: 500 });

    return Response.json({
      ok: true,
      changed: true,
      h4CountBefore: (before.match(/<h4/g) || []).length,
      h3CountAfter: (after.match(/<h3/g) || []).length,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
