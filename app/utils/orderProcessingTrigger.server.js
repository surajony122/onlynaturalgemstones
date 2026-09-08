/**
 * The "is this order due for its processing WhatsApp + email" check --
 * shared between two callers:
 *
 *   1. webhooks.orders.updated.jsx (the fast path) -- fires the instant
 *      Shopify happens to send an orders/updated webhook for the order.
 *   2. cron.order-processing-catchup.jsx (the safety net) -- Shopify's
 *      own developer community confirms marking an order "in progress"
 *      does NOT reliably fire orders/updated at all (it's often a pure
 *      timeline annotation with no underlying field change, so nothing
 *      "commits" for the webhook system to notice). Confirmed live,
 *      twice, on real orders: one never got a webhook until a tag was
 *      added days later; another only got notified because SOME OTHER
 *      unrelated order activity happened to fire orders/updated three
 *      days after the actual "in progress" click, and that webhook's
 *      events query still happened to have the old event in its most-
 *      recent-10 window. Neither is something the webhook path alone
 *      can be relied on to catch -- the poll exists specifically to
 *      pick up what the webhook missed.
 *
 * Both callers pass an ORDER-SHAPED object matching Shopify's REST
 * order payload fields (id, tags, admin_graphql_api_id, customer,
 * shipping_address, billing_address, email, name, order_number) --
 * the poll caller builds this shape itself from a GraphQL orders query
 * (see that file) so this function doesn't need to know which
 * transport the caller used to get the order.
 *
 * Every outcome is reported back through the caller-supplied
 * `setDetail` callback so both the webhook's WebhookReceiptLog row and
 * the cron run's own log rows show the same "what happened" story.
 */
import prisma from "../db.server";
import { getAppSettings, DEFAULT_ORDER_PROCESSING_TRIGGER_TAG } from "./appSettings.server";
import { sendOrderProcessingWhatsApp } from "./interakt.server";
import { sendOrderProcessingEmail } from "./orderProcessingEmail.server";

export async function checkAndNotifyOrderProcessing({ admin, shop, payload, setDetail }) {
  const orderId = String(payload?.id || "");
  if (!orderId) {
    await setDetail("skipped: no order id in payload");
    return;
  }

  // Never send a "your order is being processed" notification for an
  // order that's already moved past processing -- confirmed live this
  // matters: the catch-up poll (see cron.order-processing-catchup.jsx)
  // scans a 14-day window of recently-UPDATED orders, which surfaced
  // several real orders still carrying the trigger tag from a while
  // back that had since been delivered, returned, or refunded (their
  // own recent Timeline events mentioned exactly that). A customer
  // whose order already arrived doesn't need a "processing" email or
  // WhatsApp -- this check applies to BOTH callers (webhook and poll)
  // since a delayed/duplicate webhook delivery for an old, since-
  // fulfilled order could hit the same problem.
  const fulfillmentStatus = String(payload?.fulfillment_status || "").toLowerCase();
  if (payload?.cancelled_at) {
    await setDetail(`skipped: order was cancelled at ${payload.cancelled_at}`);
    return;
  }
  if (fulfillmentStatus === "fulfilled") {
    await setDetail("skipped: order is already fulfilled");
    return;
  }

  const settings = await getAppSettings(shop);
  const triggerTag = (settings.orderProcessingTriggerTag || DEFAULT_ORDER_PROCESSING_TRIGGER_TAG).trim().toLowerCase();

  // Trigger 1: tag — Shopify's REST-shaped payload has tags as one
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
  // fetched when the tag check alone didn't already decide it, to keep
  // the common no-op case (neither trigger applies) to a single
  // GraphQL call at most.
  //
  // Retried with a short pause between attempts (0s, 2.5s) for the
  // webhook path's benefit (Shopify's own webhook response timeout
  // makes a longer retry risky there) — harmless extra latency for the
  // cron path, which has no such deadline.
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
        return;
      }
      const eventNodes = json?.data?.order?.events?.nodes || [];
      recentEventMessages = eventNodes.map((e) => e.message).filter(Boolean);
      // Nodes are already newest-first (reverse: true) — the first
      // match is the MOST RECENT "in progress" event, which is what
      // determines this order's current triggerKey. An older matching
      // event further down the list doesn't matter once a newer one
      // exists.
      latestInProgressEvent = eventNodes.find((e) => String(e.message || "").toLowerCase().includes("in progress")) || null;
      if (latestInProgressEvent) break;
    }
  }

  if (!hasTriggerTag && !latestInProgressEvent) {
    await setDetail(
      `no trigger — order tags: [${orderTags.join(", ") || "none"}] (looking for: "${triggerTag}"), ` +
        `recent events: [${recentEventMessages.map((m) => JSON.stringify(m.slice(0, 60))).join(", ") || "none"}]`
    );
    return;
  }

  // "tag" for the tag trigger (fires once ever per order); the
  // matching event's own createdAt for the events trigger (fires once
  // per DISTINCT "in progress" occurrence — a later, genuinely new
  // occurrence gets its own, different triggerKey and so notifies
  // again).
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
  // attempted for that same occurrence.
  const detailParts = { trigger: `triggered by ${triggerReason}`, whatsapp: null, email: null };
  const writeCombinedDetail = () =>
    setDetail(
      [detailParts.trigger, detailParts.whatsapp && `WhatsApp: ${detailParts.whatsapp}`, detailParts.email && `Email: ${detailParts.email}`]
        .filter(Boolean)
        .join(" | ")
    );

  // Shipping address phone first -- confirmed live to be the reliable
  // one. Customer profile phone next, then billing address, with the
  // order-level field checked LAST since it's the one that was wrong.
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
  // NOT a separate findUnique-then-create (real race: two callers
  // detecting the same occurrence at once -- e.g. the webhook AND the
  // catch-up poll running within seconds of each other -- could both
  // pass an "not already sent" check before either had written its
  // row). Whichever caller's create() succeeds owns sending; the other
  // treats P2002 as "already claimed" and skips.
  let waClaim = null;
  try {
    waClaim = await prisma.orderProcessingNotification.create({
      data: { shop, orderId, triggerKey, orderName: orderNumber, phone, status: "sending..." },
    });
  } catch (err) {
    detailParts.whatsapp = err?.code === "P2002" ? "skipped, already claimed by another delivery/run" : "failed to claim -- " + String((err && err.message) || err);
  }

  if (waClaim) {
    detailParts.whatsapp = `sending to ${phone || "(none found)"} (source: ${phoneSource})...`;
    // Fire-and-forget -- see Channel 2's note below for why.
    sendOrderProcessingWhatsApp(settings, { phone, firstName, orderNumber, shop })
      .catch((err) => "threw: " + String((err && err.message) || err))
      .then(async (waStatus) => {
        await prisma.orderProcessingNotification.update({ where: { id: waClaim.id }, data: { status: waStatus } }).catch(() => {});
        detailParts.whatsapp = `sent to ${phone || "(none found)"} (source: ${phoneSource}) -> ${waStatus}`;
        await writeCombinedDetail();
      });
  }

  // --- Channel 2: Email -----------------------------------------------
  // Fire-and-forget (not awaited before this function returns) on
  // purpose: Gmail's SMTP connection used to hang for the full 30s
  // connection-timeout ceiling on Render's free web-service plan
  // (fixed by upgrading off that plan -- see render.yaml), and even
  // now there's no reason to hold the webhook's HTTP response (or the
  // cron run's own response) open for a network round trip that isn't
  // needed to decide what to do next. This is a persistent Render web
  // service, not a serverless function frozen the instant a response
  // is sent, so the promise below keeps running to completion in the
  // background regardless of which caller triggered it.
  let emailClaim = null;
  try {
    emailClaim = await prisma.orderProcessingEmailNotification.create({
      data: { shop, orderId, triggerKey, orderName: orderNumber, email: emailAddr, status: "sending..." },
    });
  } catch (err) {
    detailParts.email = err?.code === "P2002" ? "skipped, already claimed by another delivery/run" : "failed to claim -- " + String((err && err.message) || err);
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
  // whichever channels are in flight) -- each background completion
  // above overwrites this again with its own final result once it
  // finishes.
  await writeCombinedDetail();
}
