/**
 * refunds/create webhook -- the sole trigger for the "Refund Processed"
 * WhatsApp message (see sendRefundProcessedWhatsApp in interakt.server.js).
 * Fires the instant staff click Refund on an order in Shopify Admin --
 * confirmed to be the exact same action that produces Shopify's own
 * "You sent a refund notification email to..." Timeline entry on the
 * order. No tag, no page, no manual button. Per explicit request this
 * app only automates the refund side of this feature (an earlier
 * attempt to automate off Shopify's separate native Returns feature
 * instead was tried and reverted -- see returnId on
 * OrderReturnEmailNotification). This app no longer sends its own
 * Return/Refund emails at all -- Shopify's own native refund email
 * covers that.
 *
 * Same logging pattern as webhooks.orders.updated.jsx: authenticate,
 * write an unconditional WebhookReceiptLog row before anything else can
 * short-circuit or throw, then update that row's detail as processing
 * proceeds.
 *
 * The REST-shaped refunds/create payload carries the refund's own
 * transactions (amount/currency/status) but no customer/phone/order-name
 * info, so the order is re-fetched via GraphQL using payload.order_id.
 *
 * Idempotency: the refund's own id is stored as OrderReturnEmailNotification
 * .refundId (unique) -- a redelivered webhook for the same refund hits
 * that unique constraint on create() and is skipped rather than sending
 * the WhatsApp message a second time.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendRefundProcessedWhatsApp } from "../utils/interakt.server";

function resolvePhone(order) {
  if (order?.shippingAddress?.phone) return order.shippingAddress.phone;
  if (order?.customer?.phone) return order.customer.phone;
  if (order?.billingAddress?.phone) return order.billingAddress.phone;
  return null;
}

// Sums the refund's own transaction amounts (successful refund
// transactions only -- excludes e.g. a "pending" or "failure" status
// entry) and formats the total using that transaction's own currency,
// same "₹1,500.00"-style formatting the WhatsApp template expects (see
// sendRefundProcessedWhatsApp's doc comment).
function formatRefundAmount(transactions) {
  const list = Array.isArray(transactions) ? transactions : [];
  const successful = list.filter((t) => String(t?.kind || "").toLowerCase() === "refund" && String(t?.status || "").toLowerCase() === "success");
  const usable = successful.length ? successful : list;
  if (!usable.length) return null;

  const total = usable.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
  const currency = usable.find((t) => t.currency)?.currency || "INR";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(total);
  } catch {
    return `${currency} ${total.toFixed(2)}`;
  }
}

async function fetchOrderForRefundWhatsapp(admin, orderGid) {
  const res = await admin.graphql(
    `#graphql
    query OrderForRefundWhatsapp($id: ID!) {
      order(id: $id) {
        name
        customer { firstName phone }
        shippingAddress { phone }
        billingAddress { phone }
      }
    }`,
    { variables: { id: orderGid } }
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`OrderForRefundWhatsapp query failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.order || null;
}

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}, refund ${payload?.id}, order ${payload?.order_id}`);

  let receiptId = null;
  try {
    const receipt = await prisma.webhookReceiptLog.create({
      data: { topic: topic || "unknown", shop: shop || null, orderId: payload?.order_id ? String(payload.order_id) : null },
    });
    receiptId = receipt.id;
  } catch (err) {
    console.error("[webhooks.refunds.create] failed to log receipt:", err);
  }

  const setDetail = async (detail) => {
    console.log(`[webhooks.refunds.create] refund ${payload?.id}: ${detail}`);
    if (!receiptId) return;
    try {
      await prisma.webhookReceiptLog.update({ where: { id: receiptId }, data: { detail } });
    } catch (err) {
      console.error("[webhooks.refunds.create] failed to update receipt detail:", err);
    }
  };

  if (!admin) {
    await setDetail("skipped: no admin session (app uninstalled?)");
    return new Response();
  }

  const refundId = String(payload?.id || "");
  const orderId = String(payload?.order_id || "");
  if (!refundId || !orderId) {
    await setDetail("skipped: no refund id or order id in payload");
    return new Response();
  }

  // Atomic claim on this refund id -- whichever delivery's create()
  // succeeds owns sending; a redelivery hits the unique constraint and
  // is treated as already handled.
  let claim = null;
  try {
    claim = await prisma.orderReturnEmailNotification.create({
      data: { shop, orderId, type: "refund_whatsapp", refundId, status: "sending..." },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      await setDetail("skipped: already handled (duplicate webhook delivery for this refund)");
    } else {
      await setDetail("failed to claim -- " + String((err && err.message) || err));
    }
    return new Response();
  }

  try {
    const refundAmount = formatRefundAmount(payload?.transactions);
    if (!refundAmount) {
      await setDetail("skipped: no successful refund transaction amount in payload");
      await prisma.orderReturnEmailNotification.update({ where: { id: claim.id }, data: { status: "skipped: no refund amount in payload" } });
      return new Response();
    }

    const order = await fetchOrderForRefundWhatsapp(admin, `gid://shopify/Order/${orderId}`);
    if (!order) {
      await setDetail("skipped: order not found");
      await prisma.orderReturnEmailNotification.update({ where: { id: claim.id }, data: { status: "skipped: order not found" } });
      return new Response();
    }

    const settings = await getAppSettings(shop);
    const firstName = order.customer?.firstName || "there";
    const phone = resolvePhone(order);
    const orderNumber = order.name;

    const result = await sendRefundProcessedWhatsApp(settings, { phone, firstName, orderNumber });

    await prisma.orderReturnEmailNotification.update({
      where: { id: claim.id },
      data: { orderName: orderNumber, amount: refundAmount, status: result },
    });
    await setDetail(`sent to ${phone || "(none found)"}, amount ${refundAmount} -> ${result}`);
  } catch (err) {
    const detail = "threw: " + String((err && err.message) || err);
    console.error("[webhooks.refunds.create] failed:", err);
    await setDetail(detail);
    await prisma.orderReturnEmailNotification.update({ where: { id: claim.id }, data: { status: detail } }).catch(() => {});
  }

  return new Response();
};
