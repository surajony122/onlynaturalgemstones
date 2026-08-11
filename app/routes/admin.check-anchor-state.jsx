/**
 * TEMPORARY diagnostic route — dumps the current tab_1_content value to
 * verify the anchor inline styles actually landed correctly. Delete once
 * done.
 *
 *   GET /admin/check-anchor-state?secret=<MIGRATION_SECRET>&handle=blue-sapphire&key=tab_1_content
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

  const res = await admin.graphql(
    `#graphql
    query CheckField($handle: String!, $key: String!) {
      collectionByHandle(handle: $handle) {
        metafield(namespace: "custom", key: $key) { value }
      }
    }`,
    { variables: { handle, key } },
  );
  const json = await res.json();
  const value = json.data?.collectionByHandle?.metafield?.value || null;
  const anchors = value ? value.match(/<a\s[^>]*>/g) : [];
  return Response.json({ ok: true, anchors });
};
