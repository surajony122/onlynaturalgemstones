/**
 * TEMPORARY diagnostic route — dumps what getProductDesigns() actually
 * returns for "test" so we can see if it has leftover/stray metaobject
 * design entries. Delete once the mystery is resolved.
 *
 *   GET /admin/debug-product-designs?secret=<MIGRATION_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { getProductDesigns } from "../utils/shopify-admin.server";
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

  const combos = [
    ["ring", "silver"],
    ["pendant", "silver"],
    ["ring", "copper"],
    ["bracelet", "silver"],
  ];
  const results = {};
  for (const [type, metal] of combos) {
    results[`${type}/${metal}`] = await getProductDesigns(admin, productGid, type, metal);
  }
  return Response.json(results);
};
