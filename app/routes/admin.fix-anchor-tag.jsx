/**
 * TEMPORARY one-time fix — Blue Sapphire's tab_1_content has an anchor
 * tag missing its closing '>' before the link text:
 *   <a href="/collections/blue-sapphire" Blue Sapphire</a>
 * which makes the browser swallow everything up to the next literal '>'
 * as bogus attributes (hiding "Blue Sapphire" and breaking the rest of
 * the tab). Fixes it to a properly closed opening tag. Delete once run.
 *
 *   GET /admin/fix-anchor-tag?secret=<MIGRATION_SECRET>&handle=blue-sapphire&key=tab_1_content
 */
import shopify from "../shopify.server";
import db from "../db.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";

const BROKEN = '<a href="/collections/blue-sapphire" Blue Sapphire</a>';
const FIXED = '<a href="/collections/blue-sapphire">Blue Sapphire</a>';

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== MIGRATION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ error: "No shop installed" }, { status: 500 });

  const { admin } = await shopify.unauthenticated.admin(session.shop);
  const handle = url.searchParams.get("handle") || "blue-sapphire";
  const key = url.searchParams.get("key") || "tab_1_content";

  try {
    const findRes = await admin.graphql(
      `#graphql
      query FindField($handle: String!, $key: String!) {
        collectionByHandle(handle: $handle) {
          id
          metafield(namespace: "custom", key: $key) { id type value }
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
    if (!before.includes(BROKEN)) {
      return Response.json({ ok: true, message: "Broken pattern not found, nothing to change.", hasIt: before.includes(BROKEN) });
    }
    const after = before.replace(BROKEN, FIXED);

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
            { ownerId: collection.id, namespace: "custom", key, type: metafield.type, value: after },
          ],
        },
      },
    );
    const setJson = await setRes.json();
    if (setJson.errors) return Response.json({ ok: false, errors: setJson.errors }, { status: 500 });
    const userErrors = setJson.data?.metafieldsSet?.userErrors;
    if (userErrors?.length) return Response.json({ ok: false, userErrors }, { status: 500 });

    return Response.json({ ok: true, changed: true });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
