/**
 * Free-tier alternative to a paid Render Cron Job: hit this URL once a day
 * from a free external scheduler (cron-job.org, GitHub Actions, etc. —
 * see DEPLOYMENT.md) to run the same abandoned-variant cleanup a Render
 * Cron Job would have done.
 *
 *   GET /cron/cleanup?secret=<CRON_SECRET>
 *
 * Protected by a shared secret (CRON_SECRET env var) rather than Shopify
 * request signing, since the caller here is an external scheduler, not
 * the storefront — anyone without the secret gets a 401, so this can't be
 * used to trigger deletions by a random caller finding the URL.
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { cleanupAbandonedVariants } from "../utils/cleanupVariants.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  }
  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ ok: true, note: "No shop installed yet — nothing to clean up." });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const result = await cleanupAbandonedVariants(admin);
    console.log(`[cron.cleanup] ${session.shop}:`, result);
    return Response.json({ ok: true, shop: session.shop, ...result });
  } catch (err) {
    console.error("[cron.cleanup] failed:", err);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
};
