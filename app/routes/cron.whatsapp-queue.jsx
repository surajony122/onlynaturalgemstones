/**
 * Free-tier alternative to a paid Render Cron Job (same pattern as
 * cron.cleanup.jsx / cron.wishlist-email.jsx): hit this URL periodically
 * from a free external scheduler (cron-job.org, GitHub Actions, etc.) to
 * advance the WhatsApp send queue — see processWhatsAppQueue in
 * whatsappQueue.server.js for the actual pacing logic.
 *
 *   GET /cron/whatsapp-queue?secret=<CRON_SECRET>
 *
 * Unlike cron.wishlist-email.jsx, HOW OFTEN you ping this matters — each
 * call only ever sends at most one message, so if your pacing interval
 * is e.g. "5 minutes", ping this at least every ~5 minutes (pinging more
 * often than the interval is harmless — most calls will just report
 * "Not due yet"). If your scheduler's shortest interval is coarser than
 * what you set here, the queue will simply drain slower than configured,
 * never faster.
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
