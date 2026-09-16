/**
 * returns/process webhook -- the sole trigger for the "Return Received"
 * WhatsApp message (see sendReturnReceivedWhatsApp in interakt.server.js).
 * Fires whenever a return on an order is processed in Shopify Admin
 * (Shopify's own native Returns feature: Request -> Approve -> Receive/
 * Process, the "Process return" action where staff mark items received
 * and give each a disposition) -- no tag, no page, no manual button.
 * Per explicit request this app only automates the RETURN side of this
 * feature, not refunds -- a refund is a separate Shopify action with no
 * automation here. The old manual Return WhatsApp / Refund WhatsApp
 * buttons and this app's own Return/Refund emails have all been
 * removed -- Shopify's own native order notifications cover the email
 * side now.
 *
 * Same logging pattern as webhooks.orders.updated.jsx: authenticate,
 * write an unconditional WebhookReceiptLog row before anything else can
 * short-circuit or throw, then update that row's detail as processing
 * proceeds.
 *
 * Requires the read_returns scope (added alongside this feature --
 * needs `shopify app deploy --allow-updates` to actually register with
 * Shopify and prompt the merchant for one-time re-approval).
 *
 * Return webhooks are GraphQL-only, and the delivered payload carries
 * the return + order ids but no customer/phone/order-name info, so the
 * order is re-fetched via GraphQL using payload.order.id.
 *
 * "returns/process" fires once per processing batch, which can be more
 * than once for a single return if staff process it in multiple
 * batches (e.g. partial receipt). Only the FIRST processing event for a
 * given return sends the WhatsApp message -- the return's own id is
 * stored as OrderReturnEmailNotification.returnId (unique), so a later
 * batch (or a redelivered webhook for the same batch) hits that unique
 * constraint on create() and is skipped rather than notifying the
 * customer again for the same return.
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendReturnReceivedWhatsApp } from "../utils/interakt.server";

function resolvePhone(order) {
  if (order?.shippingAddress?.phone) return order.shippingAddress.phone;
  if (order?.customer?.phone) return order.customer.phone;
  if (order?.billingAddress?.phone) return order.billingAddress.phone;
  return null;
}

async function fetchOrderForReturnWhatsapp(admin, orderGid) {
  const res = await admin.graphql(
    `#graphql
    query OrderForReturnWhatsapp($id: ID!) {
      order(id: $id) {
        name
        statusPageUrl
        customer { firstName phone }
        shippingAddress { phone }
        billingAddress { phone }
      }
    }`,
    { variables: { id: orderGid } }
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`OrderForReturnWhatsapp query failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.order || null;
}

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  const orderId = payload?.order?.id ? String(payload.order.id) : null;
  console.log(`Received ${topic} webhook for ${shop}, return ${payload?.id}, order ${orderId}`);

  let receiptId = null;
  try {
    const receipt = await prisma.webhookReceiptLog.create({
      data: { topic: topic || "unknown", shop: shop || null, orderId },
    });
    receiptId = receipt.id;
  } catch (err) {
    console.error("[webhooks.returns.process] failed to log receipt:", err);
  }

  const setDetail = async (detail) => {
    console.log(`[webhooks.returns.process] return ${payload?.id}: ${detail}`);
    if (!receiptId) return;
    try {
      await prisma.webhookReceiptLog.update({ where: { id: receiptId }, data: { detail } });
    } catch (err) {
      console.error("[webhooks.returns.process] failed to update receipt detail:", err);
    }
  };

  if (!admin) {
    await setDetail("skipped: no admin session (app uninstalled?)");
    return new Response();
  }

  const returnId = payload?.id ? String(payload.id) : null;
  if (!returnId || !orderId) {
    await setDetail("skipped: no return id or order id in payload");
    return new Response();
  }

  // Atomic claim on this return id -- whichever delivery's create()
  // succeeds owns sending; a redelivery (or a later partial-processing
  // batch on the same return) hits the unique constraint and is treated
  // as already handled.
  let claim = null;
  try {
    claim = await prisma.orderReturnEmailNotification.create({
      data: { shop, orderId, type: "return_whatsapp", returnId, status: "sending..." },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      await setDetail("skipped: already handled (duplicate delivery, or a later batch on the same return)");
    } else {
      await setDetail("failed to claim -- " + String((err && err.message) || err));
    }
    return new Response();
  }

  try {
    const order = await fetchOrderForReturnWhatsapp(admin, `gid://shopify/Order/${orderId}`);
    if (!order) {
      await setDetail("skipped: order not found");
      await prisma.orderReturnEmailNotification.update({ where: { id: claim.id }, data: { status: "skipped: order not found" } });
      return new Response();
    }

    const settings = await getAppSettings(shop);
    const firstName = order.customer?.firstName || "there";
    const phone = resolvePhone(order);
    const orderNumber = order.name;

    const result = await sendReturnReceivedWhatsApp(settings, { phone, firstName, orderNumber, orderStatusUrl: order.statusPageUrl });

    await prisma.orderReturnEmailNotification.update({
      where: { id: claim.id },
      data: { orderName: orderNumber, status: result },
    });
    await setDetail(`sent to ${phone || "(none found)"} -> ${result}`);
  } catch (err) {
    const detail = "threw: " + String((err && err.message) || err);
    console.error("[webhooks.returns.process] failed:", err);
    await setDetail(detail);
    await prisma.orderReturnEmailNotification.update({ where: { id: claim.id }, data: { status: detail } }).catch(() => {});
  }

  return new Response();
};
