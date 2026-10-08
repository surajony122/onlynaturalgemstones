/**
 * The "Retry" and "Mark as resolved" buttons on the Overview's "Needs
 * attention" panel. Each failure shown there (see attention.server.js)
 * carries a `kind` and a row `id`; this file knows how to retry that exact
 * send and, crucially, how to WRITE THE NEW RESULT BACK to the same row, so
 * a successful retry makes the failure drop off the panel instead of
 * lingering until it is 7 days old.
 *
 * Retry re-sends one message to a customer, using the same helpers the
 * individual pages already use (Astro Leads, Wishlist Leads, Messages &
 * Orders, GST Invoices). It only ever resends the ONE channel that failed,
 * so a customer whose WhatsApp worked is never sent a second WhatsApp
 * because their email had failed.
 *
 * "Mark as resolved" does not send anything. It rewrites a failed status to
 * "dismissed by staff (was: <the original error>)", which attention.server.js
 * no longer counts as a failure, while keeping the original error text on
 * record. Use it when the cause is already understood or fixed and re-sending
 * days later would only confuse the customer.
 */
import prisma from "../db.server";
import { getAppSettings } from "./appSettings.server";
import { sendGemRecommendationEmail, sendWhatsAppForLead } from "./astroAdvice.server";
import { resendWishlistLeadEmail, resendWishlistWhatsapp } from "./wishlist.server";
import { sendOrderProcessingWhatsApp, sendRefundProcessedWhatsApp } from "./interakt.server";
import { sendOrderProcessingEmail } from "./orderProcessingEmail.server";
import { sendOrderInvoiceEmail } from "./orderInvoice.server";
import { sendAbandonedCheckoutEmail } from "./abandonedCheckoutEmail.server";

const ok = (status) => String(status || "").startsWith("OK");

function orderGid(orderId) {
  const id = String(orderId || "");
  return id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

async function fetchOrder(admin, orderId) {
  const res = await admin.graphql(
    `#graphql
    query OrderForRetry($id: ID!) {
      order(id: $id) {
        name
        email
        statusPageUrl
        customer { firstName lastName email phone }
        shippingAddress { name phone }
        billingAddress { phone }
      }
    }`,
    { variables: { id: orderGid(orderId) } }
  );
  const json = await res.json();
  if (json.errors?.length) throw new Error("Shopify order lookup failed: " + json.errors.map((e) => e.message).join("; "));
  if (!json.data?.order) throw new Error("Shopify could not find this order any more.");
  return json.data.order;
}

const firstPhone = (order) => order?.shippingAddress?.phone || order?.customer?.phone || order?.billingAddress?.phone || null;

// ---- one retry per kind. Each returns a status string ("OK: ..." on success).
const RETRY = {
  async "astro-email"({ admin, id }) {
    const lead = await prisma.astroLead.findUnique({ where: { id } });
    if (!lead) return "error: lead not found";
    if (!lead.email) return "skipped: lead has no email";
    if (!lead.recommendation) return "skipped: lead has no saved recommendation to send";
    const settings = await getAppSettings(lead.shop);
    const status = await sendGemRecommendationEmail(
      admin,
      settings,
      { name: lead.name, email: lead.email },
      { ascendant: lead.ascendant, moonsign: lead.moonsign, sunsign: lead.sunsign },
      lead.recommendation,
      lead.trackingId
    );
    await prisma.astroLead.update({ where: { id }, data: { emailSendStatus: status } });
    return status;
  },

  async "astro-whatsapp"({ admin, id, shop }) {
    const lead = await prisma.astroLead.findUnique({ where: { id } });
    if (!lead) return "error: lead not found";
    const settings = await getAppSettings(lead.shop || shop);
    const status = await sendWhatsAppForLead(admin, settings, lead);
    await prisma.astroLead.update({ where: { id }, data: { whatsappSendStatus: status, whatsappFirstSentAt: lead.whatsappFirstSentAt || new Date() } });
    return status;
  },

  // These two already write their own result back to the lead row.
  "wishlist-email": ({ admin, id }) => resendWishlistLeadEmail(admin, id),
  "wishlist-whatsapp": ({ id }) => resendWishlistWhatsapp(id),

  async "order-whatsapp"({ id, shop }) {
    const row = await prisma.orderProcessingNotification.findUnique({ where: { id } });
    if (!row) return "error: notification not found";
    if (!row.phone) return "skipped: no phone number was saved for this order";
    const settings = await getAppSettings(row.shop || shop);
    const status = await sendOrderProcessingWhatsApp(settings, { phone: row.phone, firstName: "there", orderNumber: row.orderName, shop: row.shop || shop });
    await prisma.orderProcessingNotification.update({ where: { id }, data: { status, notifiedAt: new Date() } });
    return status;
  },

  async "order-email"({ admin, id, shop }) {
    const row = await prisma.orderProcessingEmailNotification.findUnique({ where: { id } });
    if (!row) return "error: notification not found";
    const order = await fetchOrder(admin, row.orderId);
    const settings = await getAppSettings(row.shop || shop);
    // Rebuild the REST-shaped order the email sender expects, from the live Shopify order.
    const payload = {
      name: order.name,
      email: order.email || order.customer?.email || row.email,
      customer: { first_name: order.customer?.firstName, name: [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") },
      shipping_address: { name: order.shippingAddress?.name },
      order_status_url: order.statusPageUrl,
    };
    const status = await sendOrderProcessingEmail(admin, settings, payload);
    await prisma.orderProcessingEmailNotification.update({ where: { id }, data: { status, notifiedAt: new Date() } });
    return status;
  },

  async refund({ admin, id, shop }) {
    const row = await prisma.orderReturnEmailNotification.findUnique({ where: { id } });
    if (!row) return "error: notification not found";
    const order = await fetchOrder(admin, row.orderId);
    const phone = firstPhone(order);
    if (!phone) return "skipped: no phone number on this order";
    const settings = await getAppSettings(row.shop || shop);
    const status = await sendRefundProcessedWhatsApp(settings, {
      phone,
      firstName: order.customer?.firstName || "there",
      orderNumber: order.name,
      orderStatusUrl: order.statusPageUrl,
    });
    await prisma.orderReturnEmailNotification.update({ where: { id }, data: { orderName: order.name, status } });
    return status;
  },

  // Resends from the snapshot saved when the email was first attempted, so nothing is asked of Shopify again.
  async "abandoned-email"({ admin, id, shop }) {
    const row = await prisma.abandonedCheckoutEmail.findUnique({ where: { id } });
    if (!row) return "error: record not found";
    if (!row.snapshot) return "skipped: no saved cart details to resend from";
    // Never resend to someone who has unsubscribed since.
    if (row.email && (await prisma.abandonedCheckoutOptOut.findUnique({ where: { email: row.email } }))) {
      return "skipped: this address has unsubscribed from cart reminders";
    }
    const settings = await getAppSettings(row.shop || shop);
    const status = await sendAbandonedCheckoutEmail(admin, settings, row.snapshot);
    await prisma.abandonedCheckoutEmail.update({ where: { id }, data: { status, notifiedAt: new Date() } });
    return status;
  },

  async invoice({ admin, id, shop }) {
    const row = await prisma.orderInvoice.findUnique({ where: { id } });
    if (!row) return "error: invoice record not found";
    const settings = await getAppSettings(row.shop || shop);
    // Writes its own result (OK or FAILED) back to the invoice row.
    return sendOrderInvoiceEmail(admin, settings, row.shop || shop, row.orderId);
  },
};

// ---- which table/column holds each kind's status, for "Mark as resolved"
const STATUS_COLUMN = {
  "astro-email": { model: "astroLead", field: "emailSendStatus" },
  "astro-whatsapp": { model: "astroLead", field: "whatsappSendStatus" },
  "astro-shopify": { model: "astroLead", field: "shopifySyncStatus" },
  "wishlist-email": { model: "wishlistLead", field: "emailSendStatus" },
  "wishlist-whatsapp": { model: "wishlistLead", field: "whatsappSendStatus" },
  "order-whatsapp": { model: "orderProcessingNotification", field: "status" },
  "order-email": { model: "orderProcessingEmailNotification", field: "status" },
  refund: { model: "orderReturnEmailNotification", field: "status" },
  invoice: { model: "orderInvoice", field: "status" },
  "abandoned-email": { model: "abandonedCheckoutEmail", field: "status" },
};

/** Which kinds offer which buttons (used by attention.server.js to decide what to show). */
export const CAN_RETRY = new Set(Object.keys(RETRY));
export const CAN_DISMISS = new Set(Object.keys(STATUS_COLUMN));

export async function runAttentionAction({ admin, shop, intent, kind, id }) {
  if (!kind || !id) return { ok: false, intent, error: "Missing details for this action." };

  if (intent === "retry") {
    const fn = RETRY[kind];
    if (!fn) return { ok: false, intent, kind, id, error: "This kind of problem can't be retried from here." };
    try {
      const status = await fn({ admin, id, shop });
      return { ok: ok(status), intent, kind, id, status: String(status || "") };
    } catch (err) {
      console.error(`[attentionActions] retry ${kind} ${id} failed:`, err);
      return { ok: false, intent, kind, id, status: "threw: " + String((err && err.message) || err), error: String((err && err.message) || err) };
    }
  }

  if (intent === "dismiss") {
    const col = STATUS_COLUMN[kind];
    if (!col) return { ok: false, intent, kind, id, error: "This kind of problem can't be marked as resolved." };
    try {
      const row = await prisma[col.model].findUnique({ where: { id } });
      if (!row) return { ok: false, intent, kind, id, error: "That record no longer exists." };
      await prisma[col.model].update({ where: { id }, data: { [col.field]: `dismissed by staff (was: ${row[col.field] || "unknown"})` } });
      return { ok: true, intent, kind, id };
    } catch (err) {
      console.error(`[attentionActions] dismiss ${kind} ${id} failed:`, err);
      return { ok: false, intent, kind, id, error: String((err && err.message) || err) };
    }
  }

  return { ok: false, intent, error: "Unknown action." };
}
