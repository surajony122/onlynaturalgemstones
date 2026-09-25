/**
 * Runs the wishlist reminder check (email + WhatsApp) from inside the app itself,
 * once a minute on the clock (:00 seconds), instead of relying on an external
 * scheduler / Render Cron Job calling /cron/wishlist-email. The web service is on
 * a paid always-on plan, so a timer here keeps running.
 *
 * Each tick just calls processDueWishlistEmails, which only sends to customers whose
 * latest wishlist change is older than the "Wait time" chosen in Settings, so a
 * one-minute tick means a message goes out within a minute of its wait ending.
 *
 * Set DISABLE_WISHLIST_SCHEDULER=1 to turn it off (e.g. to go back to an external
 * caller). /cron/wishlist-email still works for manual or external triggering.
 */
import prisma from "../db.server";
import shopify from "../shopify.server";
import { processDueWishlistEmails } from "./wishlist.server";

export const WISHLIST_TICK_MS = 60 * 1000;

let started = false;
let running = false;

async function tick() {
  if (running) return; // previous run (e.g. slow email/WhatsApp send) still going
  running = true;
  try {
    const session = await prisma.session.findFirst({ where: { isOnline: false } });
    if (!session) return;
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const result = await processDueWishlistEmails(admin, session.shop);
    if (result && result.sent > 0) {
      console.log("[wishlist-scheduler] sent " + result.sent + " reminder(s)");
    }
  } catch (err) {
    console.error("[wishlist-scheduler] tick failed:", err);
  } finally {
    running = false;
  }
}

function scheduleNext() {
  // Re-aligned to the next :00 second every time so ticks don't drift, which is what
  // lets the dashboard predict the send time to the minute.
  const wait = WISHLIST_TICK_MS - (Date.now() % WISHLIST_TICK_MS) + 500;
  const t = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, wait);
  if (t && typeof t.unref === "function") t.unref();
}

export function startWishlistScheduler() {
  if (started) return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.DISABLE_WISHLIST_SCHEDULER === "1") return;
  started = true;
  console.log("[wishlist-scheduler] started (checks every minute)");
  scheduleNext();
}
