/**
 * TEMPORARY re-run — the content was re-edited since the last styling
 * pass (target="_blank" added to each anchor), which dropped the inline
 * style. Re-applies "plain semi-bold text, no default link color/
 * underline" to every anchor in tab_1_content that doesn't already have
 * it, preserving whatever other attributes (like target) are present.
 * Delete once run.
 *
 *   GET /admin/style-more-anchors?secret=<MIGRATION_SECRET>&handle=blue-sapphire&key=tab_1_content
 */
import shopify from "../shopify.server";
import db from "../db.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";
const INLINE_STYLE = 'color: inherit; text-decoration: none; font-weight: 600;';

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

    const anchorOpenTag = /<a\s+([^>]*?)>/g;
    let changedCount = 0;
    const after = before.replace(anchorOpenTag, (full, attrs) => {
      if (attrs.includes(INLINE_STYLE)) return full;
      changedCount++;
      if (/style\s*=\s*"/.test(attrs)) {
        return `<a ${attrs.replace(/style\s*=\s*"([^"]*)"/, (m, existing) => `style="${existing}; ${INLINE_STYLE}"`)}>`;
      }
      return `<a ${attrs} style="${INLINE_STYLE}">`;
    });

    if (changedCount === 0) {
      return Response.json({ ok: true, message: "No unstyled anchors found, nothing to change." });
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
            { ownerId: collection.id, namespace: "custom", key, type: metafield.type, value: after },
          ],
        },
      },
    );
    const setJson = await setRes.json();
    if (setJson.errors) return Response.json({ ok: false, errors: setJson.errors }, { status: 500 });
    const userErrors = setJson.data?.metafieldsSet?.userErrors;
    if (userErrors?.length) return Response.json({ ok: false, userErrors }, { status: 500 });

    return Response.json({ ok: true, changed: true, anchorsStyled: changedCount, resultingAnchors: after.match(/<a\s[^>]*>/g) });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
