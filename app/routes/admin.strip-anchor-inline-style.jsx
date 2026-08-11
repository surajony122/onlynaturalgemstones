/**
 * TEMPORARY one-time fix — removes the inline style="..." I previously
 * added to the 4 anchors in Blue Sapphire's tab_1_content, now that a
 * proper stylesheet rule (.shubh-aplus-tab-content-card a) handles the
 * same look. Inline styles always beat stylesheet rules regardless of
 * specificity, so leaving them in place would silently block the new
 * CSS rule from having any visible effect. Delete once run.
 *
 *   GET /admin/strip-anchor-inline-style?secret=<MIGRATION_SECRET>&handle=blue-sapphire&key=tab_1_content
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
    // Strip only the style="..." attribute off <a> tags, leave href/target etc.
    let removedCount = 0;
    const after = before.replace(/<a\s+([^>]*?)>/g, (full, attrs) => {
      if (!/style\s*=\s*"[^"]*"/.test(attrs)) return full;
      removedCount++;
      const cleaned = attrs.replace(/\s*style\s*=\s*"[^"]*"/, "").replace(/\s+/g, " ").trim();
      return `<a ${cleaned}>`;
    });

    if (removedCount === 0) {
      return Response.json({ ok: true, message: "No inline styles found, nothing to change." });
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

    return Response.json({ ok: true, changed: true, removedCount, resultingAnchors: after.match(/<a\s[^>]*>/g) });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
