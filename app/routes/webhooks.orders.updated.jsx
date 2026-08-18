/**
 * orders/updated webhook — sends the "order processing" WhatsApp
 * notification the first time an order is seen as "marked as in
 * progress." Two INDEPENDENT triggers, either one fires it:
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
 * OrderProcessingNotification (unique on orderId) is what stops this
 * from re-sending on every later orders/updated event for the same
 * order (e.g. once the tag stays on the order after it's already been
 * notified, or the "in progress" event is still the most recent one) —
 * checked BEFORE doing anything else past the receipt log, so this
 * stays a no-op fast path for the overwhelming majority of order-update
 * events.
 *
 * Every step updates the SAME WebhookReceiptLog row's `detail` field
 * (see app.server-health.jsx's "Webhook receipts" section) — nothing
 * about this handler's outcome should ever be invisible again the way
 * "found nothing to do" was before the very first rewrite of this file.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings, DEFAULT_ORDER_PROCESSING_TRIGGER_TAG } from "../utils/appSettings.server";
import { sendOrderProcessingWhatsApp } from "../utils/interakt.server";

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
    const already = await prisma.orderProcessingNotification.findUnique({ where: { orderId } });
    if (already) {
      await setDetail(`skipped: already notified at ${already.notifiedAt.toISOString()} (status: ${already.status})`);
      return new Response();
    }

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
    let recentEventMessages = [];
    let hasInProgressEvent = false;
    if (!hasTriggerTag) {
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
      hasInProgressEvent = recentEventMessages.some((m) => String(m).toLowerCase().includes("in progress"));
    }

    if (!hasTriggerTag && !hasInProgressEvent) {
      await setDetail(
        `no trigger — order tags: [${orderTags.join(", ") || "none"}] (looking for: "${triggerTag}"), ` +
          `recent events: [${recentEventMessages.map((m) => JSON.stringify(m.slice(0, 60))).join(", ") || "none"}]`
      );
      return new Response();
    }

    const phone = payload?.phone || payload?.customer?.phone || payload?.shipping_address?.phone || payload?.billing_address?.phone || null;
    const firstName = payload?.customer?.first_name || "";
    const orderNumber = payload?.name || String(payload.order_number || payload.id);
    const triggerReason = hasTriggerTag ? `tag "${triggerTag}"` : "order timeline event mentioning \"in progress\"";
    await setDetail(`triggered by ${triggerReason} — sending to phone: ${phone || "(none found)"}`);

    let status;
    try {
      status = await sendOrderProcessingWhatsApp(settings, { phone, firstName, orderNumber, shop });
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
    }
    await setDetail(`send result: ${status}`);

    // Recorded regardless of success/failure — a failed send (bad phone,
    // template not approved yet, etc.) shouldn't retry-spam the customer
    // on every subsequent orders/updated event either; fix the
    // underlying issue and resend manually if that ever matters.
    await prisma.orderProcessingNotification.create({
      data: { shop, orderId, orderName: orderNumber, phone, status },
    });
  } catch (err) {
    console.error("[webhooks.orders.updated] failed:", err);
    await setDetail("threw: " + String((err && err.message) || err));
  }

  return new Response();
};
