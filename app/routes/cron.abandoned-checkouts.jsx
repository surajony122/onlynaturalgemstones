/**
 * Scheduled sweep for the abandoned checkout reminder email (see
 * utils/abandonedCheckoutEmail.server.js).
 *
 *   GET /cron/abandoned-checkouts?secret=<CRON_SECRET>[&dryRun=1]
 *
 * It is also run from cron.order-processing-catchup.jsx, which an external
 * scheduler already hits every 5 minutes, so nothing new needs scheduling.
 * This separate URL is for calling it by hand. With dryRun=1 it only reports
 * what it WOULD do. When the feature is switched off in Settings (and this is
 * not a dry run) it does nothing.
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { runAbandonedCheckoutSweep } from "../utils/abandonedCheckoutEmail.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const expected = process.env.CRON_SECRET;
  if (!expected) return Response.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  if (url.searchParams.get("secret") !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ ok: true, note: "No shop installed yet." });

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const result = await runAbandonedCheckoutSweep({ admin, shop: session.shop, dryRun });
    return Response.json({ ok: true, dryRun, ...result });
  } catch (err) {
    console.error("[cron.abandoned-checkouts] failed:", err);
    return Response.json({ error: "Abandoned checkout sweep failed", detail: String((err && err.message) || err) }, { status: 500 });
  }
};
