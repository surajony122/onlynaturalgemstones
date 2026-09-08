/**
 * Safety-net for the "order processing" WhatsApp + email notification
 * (see orderProcessingTrigger.server.js) — catches orders where
 * webhooks.orders.updated.jsx's fast path never fired at all.
 *
 * Confirmed live, on two real orders, via Shopify's own developer
 * community: marking an order "in progress" is often a pure Timeline
 * annotation with no underlying order-field change, so the
 * orders/updated webhook frequently never fires for that action —
 * not "fires too fast for the events API to catch up" (a real, separate
 * problem already handled by the retry inside the shared checker), but
 * genuinely never delivered at all. One real order got no webhook
 * until a tag was added manually; another only got notified because
 * unrelated order activity happened to fire a webhook three days
 * later, and that webhook's events query still happened to have the
 * old "in progress" event in its most-recent-10 window.
 *
 * This job re-derives the same check independently: pull recently
 * updated orders via GraphQL, shape each into the same REST-payload
 * fields the shared checker expects, and run it. The checker's own
 * dedup (create() as an atomic claim, unique on orderId+triggerKey) is
 * what makes this safe to run on a schedule against orders the webhook
 * may have ALREADY handled — whichever caller (webhook or this poll)
 * gets there first wins the claim, the other's create() throws P2002
 * and is treated as "already claimed", not an error.
 *
 * Same free-tier pattern as cron.health-check.jsx / cron.cleanup.jsx:
 * hit this URL from an external scheduler (cron-job.org, GitHub
 * Actions, etc.) rather than a paid Render Cron Job. Set to every 5
 * minutes per explicit request (traded closer-to-instant detection for
 * ~3x the GraphQL/compute cost of the originally-recommended 15 min --
 * MAX_ORDERS_PER_RUN below keeps each individual run's cost bounded
 * regardless of the interval chosen).
 *
 *   GET /cron/order-processing-catchup?secret=<CRON_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { checkAndNotifyOrderProcessing } from "../utils/orderProcessingTrigger.server";

// Orders older than this are very unlikely to still be waiting on a
// "mark as in progress" click, and skipping them keeps each run's
// GraphQL cost bounded regardless of how large the store's order
// history gets. 14 days comfortably covers even the slowest real case
// seen so far (3 days).
const LOOKBACK_DAYS = 14;
// Capped per run (not "all orders in the window") so a busy store
// doesn't turn one poll into an unbounded number of GraphQL calls --
// the shared checker's own event-lookup retry means a single order
// with no trigger still costs a real API call. Runs every 15-30
// minutes, so anything not caught in one run gets picked up in the
// next.
const MAX_ORDERS_PER_RUN = 25;

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
    return Response.json({ ok: true, note: "No shop installed yet — nothing to check." });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const shop = session.shop;

    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await admin.graphql(
      `#graphql
      query RecentOrdersForProcessingCheck($first: Int!, $query: String!) {
        orders(first: $first, sortKey: UPDATED_AT, reverse: true, query: $query) {
          nodes {
            legacyResourceId
            name
            tags
            email
            phone
            cancelledAt
            displayFulfillmentStatus
            customer { firstName phone email }
            shippingAddress { phone }
            billingAddress { phone }
          }
        }
      }`,
      { variables: { first: MAX_ORDERS_PER_RUN, query: `updated_at:>${cutoff}` } }
    );
    const json = await res.json();
    if (json.errors) {
      return Response.json({ error: "GraphQL errors fetching recent orders", detail: json.errors }, { status: 500 });
    }
    const orders = json?.data?.orders?.nodes || [];

    const results = [];
    for (const o of orders) {
      // Reshaped into the same REST-payload field names
      // checkAndNotifyOrderProcessing already expects (it's shared with
      // the webhook, which gets a genuine REST payload) -- this is the
      // only place that needs to know GraphQL's field names differ.
      const payload = {
        id: o.legacyResourceId,
        admin_graphql_api_id: `gid://shopify/Order/${o.legacyResourceId}`,
        name: o.name,
        tags: (o.tags || []).join(", "),
        email: o.email,
        phone: o.phone,
        // GraphQL's displayFulfillmentStatus (e.g. "FULFILLED",
        // "UNFULFILLED", "PARTIAL") mapped down to lowercase so the
        // shared checker's fulfilled/cancelled guard (which was written
        // against REST's fulfillment_status/cancelled_at fields) works
        // identically regardless of which caller built this payload.
        fulfillment_status: (o.displayFulfillmentStatus || "").toLowerCase(),
        cancelled_at: o.cancelledAt || null,
        customer: o.customer ? { first_name: o.customer.firstName, phone: o.customer.phone, email: o.customer.email } : null,
        shipping_address: o.shippingAddress ? { phone: o.shippingAddress.phone } : null,
        billing_address: o.billingAddress ? { phone: o.billingAddress.phone } : null,
      };

      // Same unconditional-receipt pattern as the webhook, so this
      // poll's activity shows up in the same "Webhook receipts" table
      // on the Server page -- topic "CRON_CATCHUP" makes it obvious at
      // a glance which rows came from the poll vs a real webhook
      // delivery.
      let receiptId = null;
      try {
        const receipt = await db.webhookReceiptLog.create({
          data: { topic: "CRON_CATCHUP", shop, orderId: String(payload.id) },
        });
        receiptId = receipt.id;
      } catch (err) {
        console.error("[cron.order-processing-catchup] failed to log receipt:", err);
      }
      const setDetail = async (detail) => {
        console.log(`[cron.order-processing-catchup] order ${payload.id}: ${detail}`);
        if (!receiptId) return;
        await db.webhookReceiptLog.update({ where: { id: receiptId }, data: { detail } }).catch(() => {});
      };

      try {
        await checkAndNotifyOrderProcessing({ admin, shop, payload, setDetail });
        results.push({ order: payload.name, ok: true });
      } catch (err) {
        await setDetail("threw: " + String((err && err.message) || err));
        results.push({ order: payload.name, ok: false, error: String((err && err.message) || err) });
      }
    }

    return Response.json({ ok: true, ordersChecked: orders.length, results });
  } catch (err) {
    console.error("[cron.order-processing-catchup] failed:", err);
    return Response.json({ error: "Catch-up check failed", detail: String((err && err.message) || err) }, { status: 500 });
  }
};
