/**
 * TEMPORARY diagnostic route — finds live, published products that have
 * the old customizer's custom.customization_options metafield actually
 * set, so we can reproduce the reported "There was an error updating
 * your cart" bug on a real product instead of guessing. Delete once done.
 *
 *   GET /admin/find-customizer-products?secret=<MIGRATION_SECRET>
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

  const res = await admin.graphql(
    `#graphql
    query FindCustomizerProducts($handle: String!) {
      productByHandle: product(handle: $handle) {
        id
        handle
        title
        status
        metafield(namespace: "custom", key: "customization_options") {
          value
          references(first: 10) {
            nodes {
              ... on Product {
                id
                handle
                title
                status
                publishedOnCurrentPublication
              }
            }
          }
        }
      }
    }`,
    { variables: { handle: url.searchParams.get("handle") || "ruby-4-72-carat" } },
  );
  const json = await res.json();

  return Response.json({ ok: true, result: json.data?.productByHandle, errors: json.errors });
};
