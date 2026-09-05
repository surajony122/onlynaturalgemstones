/**
 * orders/updated webhook — sends the "order processing" WhatsApp AND
 * email notifications the first time an order is seen as "marked as in
 * progress" (email added because Shopify has no native "processing/
 * approved" notification template to hook a Liquid template into --
 * only confirmation/shipped/delivered/cancelled -- so this app sends it
 * directly via the merchant's own connected Gmail instead; see
 * orderProcessingEmail.server.js). The two channels are independent: each
 * has its own dedup table (OrderProcessingNotification for WhatsApp,
 * OrderProcessingEmailNotification for email) so one being unavailable
 * or already-sent for a given occurrence never blocks the other.
 *
 * Two INDEPENDENT triggers, either one fires both channels:
 *
 *   1. TAG: the order carries a specific tag (default
 *      "notify-processing", see AppSettings.orderProcessingTriggerTag /
 *      app.settings.jsx) — staff (or the user's own Shopify Flow) can
 *      apply this tag manually/automatically. Sourced straight from the
 *      webhook's own REST payload (payload.tags), no GraphQL call needed.
 *
 *   2. ORDER EVENTS (added after the user's own Flow proved unreliable
 *      too — same underlying detection problem, not an app bug): the
 *      order's own timeline literally shows text like "...marked 1 item
 *      as in progress" the moment staff click that action in the
 *      fulfillment card (confirmed via an early screenshot in this
 *      investigation). Queried via order.events (needs only the
 *      read_orders scope already held — no new scope, unlike the
 *      fulfillmentOrders attempt below), checking the most recent
 *      events' message text for "in progress".
 *
 * THIS REPLACES three earlier attempts that all tried to infer "in
 * progress" from Shopify's own fulfillment-STATUS fields, confirmed live
 * to be unreliable for this store's actual orders:
 *   a. order.displayFulfillmentStatus — an aggregate/display-only value
 *      (Shopify's own community docs confirm this can disagree with
 *      reality); read UNFULFILLED three separate times, 5-11 minutes
 *      apart, for a real order whose Admin UI badge showed "In progress"
 *      the whole time.
 *   b. fulfillmentOrders[].status — the more granular per-shipment field
 *      Shopify's docs point to instead; came back [CLOSED, OPEN] for
 *      that same order — never IN_PROGRESS.
 *   c. fulfillmentOrders[].requestStatus — the other status-like field
 *      on FulfillmentOrder; came back [UNSUBMITTED, UNSUBMITTED] — also
 *      never reflecting "in progress".
 * None of the three matched what the Admin UI badge showed, across
 * multiple real tests — the underlying "in progress" concept shown in
 * Admin isn't cleanly exposed as a structured field for this store's
 * order setup at all. Order EVENTS (the human-readable timeline text)
 * turned out to be the one place that concept actually lives.
 *
 * Deliberately triggered off the broad, well-documented orders/updated
 * topic (fires on essentially any order change, confirmed firing for
 * real via WebhookReceiptLog) rather than betting on one narrow topic.
 *
 * OrderProcessingNotification is now keyed on (orderId, triggerKey) —
 * NOT just orderId — per explicit user request: a genuinely NEW "marked
 * as in progress" occurrence on the same order (e.g. reverted, then
 * marked in-progress again later) should notify again, not be blocked
 * forever by the first occurrence. triggerKey is "tag" for the tag
 * trigger (a tag has no per-occurrence identity, so that one still only
 * ever fires once per order — avoids spamming on every unrelated edit
 * while the tag stays applied) or the specific matching order-timeline
 * event's createdAt for the events trigger (so each distinct event gets
 * its own notification, but the SAME event being seen again across
 * multiple unrelated later webhook firings is still deduped correctly).
 *
 * Every step updates the SAME WebhookReceiptLog row's `detail` field
 * (see app.server-health.jsx's "Webhook receipts" section) — nothing
 * about this handler's outcome should ever be invisible again the way
 * "found nothing to do" was before the very first rewrite of this file.
 *
 * Both sends are fire-and-forget (claimed via an atomic create() that
 * doubles as the dedup lock, then sent WITHOUT awaiting before this
 * handler responds) rather than awaited inline -- a stalled Gmail SMTP
 * connection was observed hanging the response for 30s, which made
 * Shopify consider the delivery failed and retry the same webhook,
 * racing the retry against the original over the same dedup row. This
 * is a persistent Render web service, so the background promises still
 * run to completion after the response is sent; they just update the
 * WebhookReceiptLog/notification rows once they finish instead of
 * making Shopify wait for them.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings, DEFAULT_ORDER_PROCESSING_TRIGGER_TAG } from "../utils/appSettings.server";
import { sendOrderProcessingWhatsApp } from "../utils/interakt.server";
import { sendOrderProcessingEmail } from "../utils/orderProcessingEmail.server";

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}, order ${payload?.id}`);

  // Unconditional, before anything else can short-circuit or throw —
  // answers "did Shopify even call this endpoint" definitively. Every
  // later branch below UPDATES this same row's `detail` as processing
  // proceeds, so the full story is visible in one place even if
  // something fails partway through.
  let receiptId = null;
  try {
    const receipt = await prisma.webhookReceiptLog.create({
      data: { topic: topic || "unknown", shop: shop || null, orderId: payload?.id ? String(payload.id) : null },
    });
    receiptId = receipt.id;
  } catch (err) {
    console.error("[webhooks.orders.updated] failed to log receipt:", err);
  }

  const setDetail = async (detail) => {
    console.log(`[webhooks.orders.updated] order ${payload?.id}: ${detail}`);
    if (!receiptId) return;
    try {
      await prisma.webhookReceiptLog.update({ where: { id: receiptId }, data: { detail } });
    } catch (err) {
      console.error("[webhooks.orders.updated] failed to update receipt detail:", err);
    }
  };

  if (!admin) {
    // Session revoked/app uninstalled — nothing we can do.
    await setDetail("skipped: no admin session (app uninstalled?)");
    return new Response();
  }

  const orderId = String(payload?.id || "");
  if (!orderId) {
    await setDetail("skipped: no order id in payload");
    return new Response();
  }

  try {
    const settings = await getAppSettings(shop);
    const triggerTag = (settings.orderProcessingTriggerTag || DEFAULT_ORDER_PROCESSING_TRIGGER_TAG).trim().toLowerCase();

    // Trigger 1: tag — Shopify's REST webhook payload has tags as one
    // comma-separated string (e.g. "vip, notify-processing, wholesale"),
    // not an array.
    const orderTags = String(payload?.tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const hasTriggerTag = orderTags.includes(triggerTag);

    // Trigger 2: order timeline events — the literal text Shopify shows
    // in the order's own Timeline the moment staff click "Mark as in
    // progress" (e.g. "Priya marked 1 item as in progress."). Only
    // fetched when the tag check alone didn't already decide it, to
    // keep the common no-op case (neither trigger applies) to a single
    // GraphQL call at most.
    //
    // Retried with a short pause between attempts (up to 2 tries: 0s,
    // 2.5s -- kept short enough to stay well under Shopify's webhook
    // response timeout, rather than risking Shopify treating a slower
    // response as a failed delivery and retrying the whole webhook
    // itself) rather than queried once -- confirmed live that clicking
    // "Mark as in progress" fires this orders/updated webhook and
    // writes the event to the order's Timeline (visible in Admin
    // immediately) FASTER than that same event becomes readable through
    // the events GraphQL connection this query uses. A single immediate
    // query came back with the event simply missing from the 10 most
    // recent -- not wrong text, not a missing scope, just not indexed
    // yet -- so the notification silently never sent for a real order
    // marked in progress seconds after being placed. Stops retrying the
    // moment a match is found; still only costs one call in the (far
    // more common) case where nothing matches at all.
    let recentEventMessages = [];
    let latestInProgressEvent = null;
    if (!hasTriggerTag) {
      const RETRY_DELAYS_MS = [0, 2500];
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (RETRY_DELAYS_MS[attempt] > 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
        const res = await admin.graphql(
          `#graphql
          query RecentOrderEvents($id: ID!) {
            order(id: $id) {
              events(first: 10, sortKey: CREATED_AT, reverse: true) {
                nodes {
                  message
                  createdAt
                }
              }
            }
          }`,
          { variables: { id: payload.admin_graphql_api_id } }
        );
        const json = await res.json();
        if (json.errors) {
          await setDetail("GraphQL errors (order events): " + JSON.stringify(json.errors).slice(0, 400));
          return new Response();
        }
        const eventNodes = json?.data?.order?.events?.nodes || [];
        recentEventMessages = eventNodes.map((e) => e.message).filter(Boolean);
        // Nodes are already newest-first (reverse: true) — the first match
        // is the MOST RECENT "in progress" event, which is what determines
        // this order's current triggerKey. An older matching event further
        // down the list doesn't matter once a newer one exists.
        latestInProgressEvent = eventNodes.find((e) => String(e.message || "").toLowerCase().includes("in progress")) || null;
        if (latestInProgressEvent) break;
      }
    }

    if (!hasTriggerTag && !latestInProgressEvent) {
      await setDetail(
        `no trigger — order tags: [${orderTags.join(", ") || "none"}] (looking for: "${triggerTag}"), ` +
          `recent events: [${recentEventMessages.map((m) => JSON.stringify(m.slice(0, 60))).join(", ") || "none"}]`
      );
      return new Response();
    }

    // "tag" for the tag trigger (fires once ever per order); the
    // matching event's own createdAt for the events trigger (fires once
    // per DISTINCT "in progress" occurrence — a later, genuinely new
    // occurrence gets its own, different triggerKey and so notifies
    // again, exactly as requested).
    const triggerKey = hasTriggerTag ? "tag" : latestInProgressEvent.createdAt;
    const triggerReason = hasTriggerTag
      ? `tag "${triggerTag}"`
      : `order timeline event at ${triggerKey} mentioning "in progress"`;
    const firstName = payload?.customer?.first_name || "";
    const orderNumber = payload?.name || String(payload.order_number || payload.id);

    // WhatsApp and email are claimed/sent/recorded independently below
    // (each against its OWN dedup table) rather than one shared "already
    // notified" gate -- otherwise the first channel to succeed for a
    // given occurrence would silently block the other from ever being
    // attempted for that same occurrence (e.g. Gmail getting configured
    // AFTER WhatsApp already fired for this order would then never send
    // the email at all). All outcomes are still combined into one
    // receipt-log line so the "what happened" story stays in one place.
    const detailParts = { trigger: `triggered by ${triggerReason}`, whatsapp: null, email: null };
    const writeCombinedDetail = () =>
      setDetail(
        [detailParts.trigger, detailParts.whatsapp && `WhatsApp: ${detailParts.whatsapp}`, detailParts.email && `Email: ${detailParts.email}`]
          .filter(Boolean)
          .join(" | ")
      );

    // Shipping address phone first -- confirmed live to be the reliable
    // one (a real order's WhatsApp send went to a stale/wrong number
    // when this prioritized the order's own top-level `phone` field
    // instead). Customer profile phone next, then billing address, with
    // the order-level field checked LAST since it's the one that was
    // wrong. phoneSource is recorded below so a future "wrong number"
    // report doesn't need a second cross-check against
    // /app/whatsapp-events to see which field was used.
    let phone = null;
    let phoneSource = "none found";
    if (payload?.shipping_address?.phone) {
      phone = payload.shipping_address.phone;
      phoneSource = "shipping_address.phone";
    } else if (payload?.customer?.phone) {
      phone = payload.customer.phone;
      phoneSource = "customer.phone";
    } else if (payload?.billing_address?.phone) {
      phone = payload.billing_address.phone;
      phoneSource = "billing_address.phone";
    } else if (payload?.phone) {
      phone = payload.phone;
      phoneSource = "order.phone (top-level -- least reliable, used only because nothing else was set)";
    }
    const emailAddr = payload?.email || payload?.customer?.email || payload?.contact_email || null;

    // --- Channel 1: WhatsApp -------------------------------------------
    // The create() call itself is the atomic claim on this occurrence --
    // NOT a separate findUnique-then-create (that had a real race: two
    // near-simultaneous webhook deliveries for the same order -- which
    // Shopify sends whenever it thinks a delivery was slow/failed, e.g.
    // while this handler was hung awaiting a stalled 30s Gmail SMTP
    // connection before responding -- could both pass the "not already
    // sent" check before either had written its row, then both try to
    // create it, and the loser crashed with a P2002 unique-constraint
    // error instead of gracefully backing off). Whichever delivery's
    // create() succeeds owns sending; the other treats P2002 as "already
    // claimed" and skips, exactly like the old "already notified" case.
    let waClaim = null;
    try {
      waClaim = await prisma.orderProcessingNotification.create({
        data: { shop, orderId, triggerKey, orderName: orderNumber, phone, status: "sending..." },
      });
    } catch (err) {
      detailParts.whatsapp = err?.code === "P2002" ? "skipped, already claimed by another delivery of this webhook" : "failed to claim -- " + String((err && err.message) || err);
    }

    if (waClaim) {
      detailParts.whatsapp = `sending to ${phone || "(none found)"} (source: ${phoneSource})...`;
      // Deliberately NOT awaited -- see the fire-and-forget note on
      // Channel 2 below for why the actual send happens after this
      // request has already responded to Shopify.
      sendOrderProcessingWhatsApp(settings, { phone, firstName, orderNumber, shop })
        .catch((err) => "threw: " + String((err && err.message) || err))
        .then(async (waStatus) => {
          await prisma.orderProcessingNotification.update({ where: { id: waClaim.id }, data: { status: waStatus } }).catch(() => {});
          detailParts.whatsapp = `sent to ${phone || "(none found)"} (source: ${phoneSource}) -> ${waStatus}`;
          await writeCombinedDetail();
        });
    }

    // --- Channel 2: Email -----------------------------------------------
    // Shopify has no native "order processing/approved" notification
    // template to hook into (only confirmation/shipped/delivered/
    // cancelled) -- this app sends it directly instead, via the
    // merchant's own connected Gmail (Settings page). See
    // orderProcessingEmail.server.js for the bundle-card email itself.
    //
    // Sending is fire-and-forget (not awaited before responding to
    // Shopify) on purpose: Gmail's SMTP connection from Render has been
    // observed to hang for the full 30s connection-timeout ceiling
    // (visible on the Server page's Gmail check) -- awaiting that here
    // would hold this webhook's HTTP response open the whole time,
    // Shopify would consider the delivery failed and retry the same
    // webhook, and the retry would race this same request over the claim
    // below (see the P2002 note above). This process is a persistent
    // Render web service, not a serverless function frozen the instant a
    // response is sent, so the promise below keeps running to completion
    // in the background exactly as if it were awaited -- the only
    // difference is Shopify no longer has to wait for it.
    let emailClaim = null;
    try {
      emailClaim = await prisma.orderProcessingEmailNotification.create({
        data: { shop, orderId, triggerKey, orderName: orderNumber, email: emailAddr, status: "sending..." },
      });
    } catch (err) {
      detailParts.email = err?.code === "P2002" ? "skipped, already claimed by another delivery of this webhook" : "failed to claim -- " + String((err && err.message) || err);
    }

    if (emailClaim) {
      detailParts.email = `sending to ${emailAddr || "(none found)"}...`;
      sendOrderProcessingEmail(admin, settings, payload)
        .catch((err) => "threw: " + String((err && err.message) || err))
        .then(async (emailStatus) => {
          await prisma.orderProcessingEmailNotification.update({ where: { id: emailClaim.id }, data: { status: emailStatus } }).catch(() => {});
          detailParts.email = emailStatus;
          await writeCombinedDetail();
        });
    }

    // Written once immediately (reflecting "claimed, sending..." for
    // whichever channels are in flight) so Shopify's response isn't held
    // up by either send -- each background completion above overwrites
    // this again with its own final result once it finishes.
    await writeCombinedDetail();
  } catch (err) {
    console.error("[webhooks.orders.updated] failed:", err);
    await setDetail("threw: " + String((err && err.message) || err));
  }

  return new Response();
};
