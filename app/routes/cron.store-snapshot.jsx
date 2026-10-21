/**
 * Scheduled check for deleted Files and theme files: same free-tier pattern as
 * cron.health-check.jsx (hit this URL from an external scheduler such as
 * cron-job.org). Shopify has no "file deleted" webhook, so this compares the
 * saved list of files with the current one and logs what vanished.
 *
 *   GET /cron/store-snapshot?secret=<CRON_SECRET>
 *
 * Every 15-30 minutes is a good rhythm: a deletion is logged with the window
 * it happened in, so the shorter the gap, the tighter that window.
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { runStoreSnapshot } from "../utils/storeActivity.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  if (!expected) return Response.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  if (secret !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ ok: true, note: "No shop installed yet — nothing to check." });

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const result = await runStoreSnapshot(admin, session.shop);
    console.log(`[cron.store-snapshot] ${session.shop}:`, JSON.stringify(result));
    return Response.json({ ok: true, shop: session.shop, ...result });
  } catch (err) {
    console.error("[cron.store-snapshot] failed:", err);
    return Response.json({ error: "Snapshot failed" }, { status: 500 });
  }
};
