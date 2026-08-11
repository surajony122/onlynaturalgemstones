/**
 * Fallback trigger for the same reprice logic now available as a button
 * in the app's own admin screen (see app/routes/app._index.jsx) — kept
 * for scripted/external use. Protected by a secret embedded directly in
 * this file (not an env var — avoids any Render dashboard changes for a
 * route that's just a backup path to the same button).
 *
 *   GET /admin/migrate-design-variants?secret=<MIGRATION_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { repriceDesignVariants } from "../utils/repriceDesignVariants.server";

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
    const result = await repriceDesignVariants(admin);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin.migrate-design-variants] failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
