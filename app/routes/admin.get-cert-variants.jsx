/**
 * One-time (or repeatable — it's idempotent, getOrCreateCertProduct just
 * finds the existing product on subsequent calls) trigger: ensures the
 * shared "Certification Upgrade" product exists and returns its variant
 * IDs so they can be embedded directly in the theme.
 *
 *   GET /admin/get-cert-variants?secret=<MIGRATION_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { getCertVariantIds } from "../utils/repriceDesignVariants.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== MIGRATION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ error: "No shop installed" }, { status: 500 });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const { variantIds, publishDiagnostic } = await getCertVariantIds(admin);
    return Response.json({ ok: true, variantIds, publishDiagnostic });
  } catch (err) {
    console.error("[admin.get-cert-variants] failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
