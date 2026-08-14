/**
 * Free-tier alternative to a paid Render Cron Job (same pattern as
 * cron.cleanup.jsx): hit this URL periodically from a free external
 * scheduler (cron-job.org, GitHub Actions, etc.) to send any wishlist
 * emails that are now due — see processDueWishlistEmails in
 * wishlist.server.js for the actual debounce/send logic.
 *
 *   GET /cron/wishlist-email?secret=<CRON_SECRET>
 *
 * How often to ping this doesn't need to match the interval setting
 * exactly — pinging every 15-30 minutes is plenty even for a 2-hour
 * interval, since a customer only actually gets emailed once their
 * specific due time has passed, whichever run happens to notice first.
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
