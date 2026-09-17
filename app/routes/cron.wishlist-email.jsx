/**
 * Runs as a real Render Cron Job now (see render.yaml's
 * wishlist-email-cron, same pattern as order-processing-catchup-cron),
 * not an external free scheduler like this file's docblock used to say
 * -- that was fine when the only thing gated on this was a multi-hour
 * WhatsApp wait time, but the wishlist reminder EMAIL now runs a
 * 3-stage sequence starting just 5 minutes after a customer's last
 * wishlist change (see WISHLIST_EMAIL_STAGES in wishlist.server.js), so
 * this needs to run every few minutes to keep that first stage
 * reasonably prompt -- an external daily/hourly ping could no longer
 * do that.
 *
 *   GET /cron/wishlist-email?secret=<CRON_SECRET>
 *
 * Still callable manually with the same URL (e.g. for local testing) --
 * nothing about the route itself changed, only what triggers it.
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { processDueWishlistEmails } from "../utils/wishlist.server";

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
    const result = await processDueWishlistEmails(admin, session.shop);
    console.log(`[cron.wishlist-email] ${session.shop}:`, result);
    return Response.json({ ok: true, shop: session.shop, ...result });
  } catch (err) {
    console.error("[cron.wishlist-email] failed:", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
};
