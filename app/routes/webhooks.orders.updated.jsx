/**
 * orders/updated webhook — sends the "order processing" WhatsApp
 * notification the first time an order is seen as IN_PROGRESS (staff
 * manually marking an item "as in progress" in the order's fulfillment
 * card — a distinct, earlier step than actually fulfilling it, confirmed
 * via a screenshot of the order timeline showing two separate entries:
 * "...marked 1 item as in progress" followed later by "...marked 1 item
 * as fulfilled").
 *
 * Checks order.displayFulfillmentStatus — the exact field driving the
 * "Fulfillment status: In progress" badge shown in Shopify Admin's own
 * order page (confirmed via screenshot) — NOT fulfillmentOrders[].status
 * as originally written; those are a different, more granular per-
 * shipment concept that can lag or differ from the order-level display
 * status a merchant actually looks at. Checking both, since either being
 * true is a reasonable signal.
 *
 * Deliberately triggered off the broad, well-documented orders/updated
 * topic (fires on essentially any order change, confirmed firing for
 * real via WebhookReceiptLog) rather than betting on one narrow, under-
 * documented FULFILLMENT_ORDERS_* topic name — this webhook just
 * re-checks the order's REAL current status via a fresh GraphQL query
 * every time, authoritative regardless of which action caused the update.
 *
 * OrderProcessingNotification (unique on orderId) is what stops this
 * from re-sending on every later orders/updated event for the same
 * order (e.g. once it's actually fulfilled/shipped) — checked BEFORE
 * doing anything else past the receipt log, so this stays a no-op fast
 * path for the overwhelming majority of order-update events.
 *
 * Every step updates the SAME WebhookReceiptLog row's `detail` field
 * (see app.server-health.jsx's "Webhook receipts" section) — nothing
 * about this handler's outcome should ever be invisible again the way
 * "found nothing to do" was before this rewrite.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
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

    // fulfillmentOrders was tried here too (belt-and-suspenders with
    // displayFulfillmentStatus) but turned out to need a scope this app
    // doesn't have (read_merchant_managed_fulfillment_orders) — confirmed
    // live via a real "Access denied for fulfillmentOrders field" error,
    // which throws and kills the WHOLE query (same GraphQL behavior
    // that's bitten this app before). Dropped entirely: adding that scope
    // would require the merchant to re-approve permissions, and it's not
    // needed anyway — displayFulfillmentStatus alone is the exact field
    // driving the "In progress" badge in Shopify Admin, a plain Order
    // field that needs nothing beyond the read_orders scope already held.
    const res = await admin.graphql(
      `#graphql
      query OrderFulfillmentStatus($id: ID!) {
        order(id: $id) {
          displayFulfillmentStatus
        }
      }`,
      { variables: { id: payload.admin_graphql_api_id } }
    );
    const json = await res.json();
    if (json.errors) {
      await setDetail("GraphQL errors: " + JSON.stringify(json.errors).slice(0, 400));
      return new Response();
    }
    const order = json?.data?.order;
    if (!order) {
      await setDetail(`no order data returned for ${payload.admin_graphql_api_id}`);
      return new Response();
    }

    const displayStatus = order.displayFulfillmentStatus;
    const isInProgress = String(displayStatus).toUpperCase() === "IN_PROGRESS";

    if (!isInProgress) {
      await setDetail(`not in progress — displayFulfillmentStatus: ${displayStatus}`);
      return new Response();
    }

    const settings = await getAppSettings(shop);
    const phone = payload?.phone || payload?.customer?.phone || payload?.shipping_address?.phone || payload?.billing_address?.phone || null;
    const firstName = payload?.customer?.first_name || "";
    const orderNumber = payload?.name || String(payload.order_number || payload.id);
    await setDetail(`IN_PROGRESS (displayFulfillmentStatus: ${displayStatus}) — sending to phone: ${phone || "(none found)"}`);

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
