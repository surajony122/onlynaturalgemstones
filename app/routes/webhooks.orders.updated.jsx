/**
 * orders/updated webhook — sends the "order processing" WhatsApp
 * notification the first time an order's fulfillment order status is
 * seen as IN_PROGRESS (staff manually marking an item "as in progress"
 * in the order's fulfillment card — a distinct, earlier step than
 * actually fulfilling it, confirmed via a screenshot of the order
 * timeline showing two separate entries: "...marked 1 item as in
 * progress" followed later by "...marked 1 item as fulfilled").
 *
 * Deliberately triggered off the broad, well-documented orders/updated
 * topic (fires on essentially any order change) rather than betting on
 * one narrow, under-documented FULFILLMENT_ORDERS_* topic name — this
 * webhook just re-checks the order's REAL current fulfillment order
 * statuses via a fresh GraphQL query every time, which is authoritative
 * regardless of which specific action caused the update.
 *
 * OrderProcessingNotification (unique on orderId) is what stops this
 * from re-sending on every later orders/updated event for the same
 * order (e.g. once it's actually fulfilled/shipped) — checked BEFORE
 * doing anything else, so this stays a no-op fast path for the
 * overwhelming majority of order-update events that aren't the one that
 * matters.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderProcessingWhatsApp } from "../utils/interakt.server";

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}, order ${payload?.id}`);

  if (!admin) {
    // Session revoked/app uninstalled — nothing we can do.
    return new Response();
  }

  const orderId = String(payload?.id || "");
  if (!orderId) return new Response();

  try {
    const already = await prisma.orderProcessingNotification.findUnique({ where: { orderId } });
    if (already) {
      console.log(`[webhooks.orders.updated] order ${orderId} already notified, skipping`);
      return new Response();
    }

    // Only fulfillmentOrders.status is fetched via GraphQL — everything
    // else (name/phone/customer) comes straight from the webhook's own
    // REST payload, which definitely has them. Kept deliberately minimal:
    // an invalid/unsupported field ANYWHERE in a GraphQL query fails the
    // WHOLE query (confirmed the hard way earlier this session with
    // Shop.brand), which would have silently killed this entire feature
    // rather than just one field.
    const res = await admin.graphql(
      `#graphql
      query OrderFulfillmentStatus($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10) {
            nodes { status }
          }
        }
      }`,
      { variables: { id: payload.admin_graphql_api_id } }
    );
    const json = await res.json();
    if (json.errors) {
      console.error(`[webhooks.orders.updated] GraphQL errors for order ${orderId}:`, JSON.stringify(json.errors).slice(0, 500));
      return new Response();
    }
    const order = json?.data?.order;
    if (!order) {
      console.error(`[webhooks.orders.updated] no order data returned for ${payload.admin_graphql_api_id}`);
      return new Response();
    }

    const statuses = (order.fulfillmentOrders?.nodes || []).map((fo) => fo.status);
    const hasInProgress = statuses.some((s) => String(s).toUpperCase() === "IN_PROGRESS");
    console.log(`[webhooks.orders.updated] order ${orderId} fulfillment order statuses: ${JSON.stringify(statuses)}`);
    if (!hasInProgress) return new Response();

    const settings = await getAppSettings(shop);
    const phone = payload?.phone || payload?.customer?.phone || payload?.shipping_address?.phone || payload?.billing_address?.phone || null;
    const firstName = payload?.customer?.first_name || "";
    const orderNumber = payload?.name || String(payload.order_number || payload.id);
    console.log(`[webhooks.orders.updated] order ${orderId} IN_PROGRESS — sending to phone: ${phone || "(none found)"}`);

    let status;
    try {
      status = await sendOrderProcessingWhatsApp(settings, { phone, firstName, orderNumber, shop });
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
      console.error("[webhooks.orders.updated] send failed:", err);
    }
    console.log(`[webhooks.orders.updated] order ${orderId} send result: ${status}`);

    // Recorded regardless of success/failure — a failed send (bad phone,
    // template not approved yet, etc.) shouldn't retry-spam the customer
    // on every subsequent orders/updated event either; fix the
    // underlying issue and resend manually if that ever matters.
    await prisma.orderProcessingNotification.create({
      data: { shop, orderId, orderName: orderNumber, phone, status },
    });
  } catch (err) {
    console.error("[webhooks.orders.updated] failed:", err);
  }

  return new Response();
};
