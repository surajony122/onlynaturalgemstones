/**
 * TEMPORARY diagnostic route — scans tab_N_content metafields on a
 * collection for <a> tags and checks whether open/close tag counts
 * match, to find an unclosed anchor swallowing the rest of the content.
 * Delete once done.
 *
 *   GET /admin/find-anchor-issue?secret=<MIGRATION_SECRET>&handle=blue-sapphire
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

  try {
    const res = await admin.graphql(
      `#graphql
      query FindAnchors($handle: String!) {
        collectionByHandle(handle: $handle) {
          id
          title
          metafields(namespace: "custom", first: 20) {
            nodes { key value }
          }
        }
      }`,
      { variables: { handle } },
    );
    const json = await res.json();
    if (json.errors) return Response.json({ ok: false, errors: json.errors }, { status: 500 });

    const collection = json.data?.collectionByHandle;
    if (!collection) return Response.json({ ok: false, error: "Collection not found" }, { status: 404 });

    const tabFields = (collection.metafields?.nodes || []).filter((m) => /^tab_\d+_content$/.test(m.key));
    const full = url.searchParams.get("full");
    if (full) {
      const match = tabFields.find((m) => m.key === full);
      return Response.json({ ok: true, key: full, value: match?.value || null });
    }
    const report = tabFields
      .map((m) => {
        const openCount = (m.value.match(/<a\s/g) || []).length;
        const closeCount = (m.value.match(/<\/a>/g) || []).length;
        if (openCount === 0) return null;
        const firstOpenIdx = m.value.search(/<a\s/);
        return {
          key: m.key,
          openCount,
          closeCount,
          balanced: openCount === closeCount,
          contextAroundFirstAnchor: m.value.slice(Math.max(0, firstOpenIdx - 60), firstOpenIdx + 300),
        };
      })
      .filter(Boolean);

    return Response.json({ ok: true, title: collection.title, anchorFields: report });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
