/**
 * Free-tier alternative to a paid Render Cron Job (same pattern as
 * cron.cleanup.jsx / cron.wishlist-email.jsx): hit this URL periodically
 * from a free external scheduler (cron-job.org, GitHub Actions, etc.) to
 * send any WhatsApp follow-up reminders that have come due — see
 * processWhatsAppQueue in whatsappQueue.server.js. The FIRST WhatsApp
 * message always sends instantly at submission time, no cron needed for
 * that part; this only covers the optional one-time follow-up.
 *
 *   GET /cron/whatsapp-queue?secret=<CRON_SECRET>
 *
 * Ping this at least as often as your configured follow-up delay (e.g.
 * every ~30 min for a 24-hour delay is plenty) — pinging more often is
 * harmless, it just finds nothing due yet.
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { processWhatsAppQueue } from "../utils/whatsappQueue.server";

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
    return Response.json({ ok: true, note: "No shop installed yet — nothing to send." });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const result = await processWhatsAppQueue(admin, session.shop);
    console.log(`[cron.whatsapp-queue] ${session.shop}:`, result);
    return Response.json({ ok: true, shop: session.shop, ...result });
  } catch (err) {
    console.error("[cron.whatsapp-queue] failed:", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
};
