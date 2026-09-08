/**
 * orders/updated webhook — the FAST PATH for the "order processing"
 * WhatsApp + email notifications (see orderProcessingTrigger.server.js
 * for the actual tag/timeline-event detection and send logic, shared
 * with cron.order-processing-catchup.jsx, the safety-net path).
 *
 * This file's only job: authenticate the webhook, log an unconditional
 * WebhookReceiptLog row (the definitive "did Shopify even call us"
 * answer — see app.server-health.jsx's "Webhook receipts" section),
 * and hand the REST-shaped payload to the shared checker.
 *
 * IMPORTANT — this webhook is NOT a reliable way to detect "marked as
 * in progress" by itself. Confirmed via Shopify's own developer
 * community and live on two real orders: marking an order "in
 * progress" is often a pure Timeline annotation with no underlying
 * order-field change, so orders/updated frequently never fires for
 * that action at all (one real order got no webhook until a tag was
 * added; another only got notified because unrelated order activity
 * fired a webhook three days later, and that webhook's events query
 * still happened to catch the old event). That gap is exactly what
 * cron.order-processing-catchup.jsx exists to close — this webhook
 * stays as the fast path for whenever Shopify does fire it (tag
 * changes reliably do), the poll is the guarantee.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkAndNotifyOrderProcessing } from "../utils/orderProcessingTrigger.server";

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
    await checkAndNotifyOrderProcessing({ admin, shop, payload, setDetail });
  } catch (err) {
    console.error("[webhooks.orders.updated] failed:", err);
    await setDetail("threw: " + String((err && err.message) || err));
  }

  return new Response();
};
