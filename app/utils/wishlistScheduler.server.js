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
 * The timer must never stop: the next tick is scheduled even if a tick throws or hangs
 * (a stuck email/WhatsApp/Shopify call used to end the whole chain, so reminders
 * silently stopped until the next restart while manual "send now" still worked). A tick
 * that runs longer than TICK_TIMEOUT_MS is abandoned and the following ticks carry on.
 * /cron/order-processing-catchup also runs the same check every 5 minutes as a backup;
 * processDueWishlistEmails claims each lead atomically, so overlapping runs never send twice.
 *
 * Set DISABLE_WISHLIST_SCHEDULER=1 to turn it off (e.g. to go back to an external
 * caller). /cron/wishlist-email still works for manual or external triggering.
 */
import prisma from "../db.server";
import shopify from "../shopify.server";
import { processDueWishlistEmails } from "./wishlist.server";

export const WISHLIST_TICK_MS = 60 * 1000;
const TICK_TIMEOUT_MS = 3 * 60 * 1000;
const HEARTBEAT_EVERY_TICKS = 60; // one "still alive" log line an hour

let started = false;
let running = false;
let runningSince = 0;
let tickCount = 0;

async function runCheck() {
  const session = await prisma.session.findFirst({ where: { isOnline: false } });
  if (!session) return null;
  const { admin } = await shopify.unauthenticated.admin(session.shop);
  return processDueWishlistEmails(admin, session.shop);
}

async function tick() {
  // A previous tick still going is normal for a slow send, but never for longer than the timeout.
  if (running && Date.now() - runningSince < TICK_TIMEOUT_MS + 30 * 1000) return;
  running = true;
  runningSince = Date.now();
  tickCount += 1;
  let timer;
  try {
    const result = await Promise.race([
      runCheck(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("tick timed out after " + TICK_TIMEOUT_MS / 1000 + "s")), TICK_TIMEOUT_MS);
      }),
    ]);
    if (result && Array.isArray(result.results) && result.results.some((r) => !/^not due yet/.test(String(r.status || "")))) {
      console.log(
        "[wishlist-scheduler] " + result.sent + " sent; " +
          result.results.map((r) => r.email + " -> " + String(r.status || "").slice(0, 80)).join(" | ")
      );
    } else if (tickCount % HEARTBEAT_EVERY_TICKS === 1) {
      console.log("[wishlist-scheduler] alive (tick " + tickCount + ")");
    }
  } catch (err) {
    console.error("[wishlist-scheduler] tick failed:", err);
  } finally {
    if (timer) clearTimeout(timer);
    running = false;
  }
}

function scheduleNext() {
  // Re-aligned to the next :00 second every time so ticks don't drift, which is what
  // lets the dashboard predict the send time to the minute.
  const wait = WISHLIST_TICK_MS - (Date.now() % WISHLIST_TICK_MS) + 500;
  const t = setTimeout(() => {
    // Schedule first, run second: whatever the tick does, the chain keeps going.
    scheduleNext();
    tick().catch((err) => console.error("[wishlist-scheduler] unexpected:", err));
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
