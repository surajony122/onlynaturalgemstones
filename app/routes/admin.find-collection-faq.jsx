/**
 * TEMPORARY diagnostic route — finds which tab_N_content metafield on a
 * collection contains FAQ markup, and shows a snippet around any <h4>
 * question headings so we can confirm before editing. Delete once done.
 *
 *   GET /admin/find-collection-faq?secret=<MIGRATION_SECRET>&handle=yellow-sapphire
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

  try {
    const res = await admin.graphql(
      `#graphql
      query FindCollectionFaq($handle: String!) {
        collectionByHandle(handle: $handle) {
          id
          title
          metafields(namespace: "custom", first: 20) {
            nodes {
              key
              type
              value
            }
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
    const summary = tabFields.map((m) => ({
      key: m.key,
      hasFaq: m.value.includes("shubh-faq") || m.value.toLowerCase().includes("faq"),
      h4Count: (m.value.match(/<h4/g) || []).length,
      h3Count: (m.value.match(/<h3/g) || []).length,
      preview: m.value.slice(0, 200),
    }));

    return Response.json({ ok: true, collectionId: collection.id, title: collection.title, tabFields: summary });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
};
