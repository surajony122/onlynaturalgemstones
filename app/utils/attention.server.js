/**
 * Cheap, DB-only "does anything need attention right now" signal, shared
 * by the app shell's sidebar (badge counts) and the Overview page's
 * "Needs attention" panel. Deliberately does NOT run the live external
 * checks the System Health page does (Gmail SMTP handshake, Shopify Admin
 * API, Interakt key validation, etc.) — those are real network round
 * trips, and this function runs on every single page navigation (it lives
 * in the app.jsx layout loader), so doing that here would slow down every
 * page load and hammer those services on every click through the app.
 *
 * Instead this looks at the last 7 days of DB rows this app already
 * writes on every send attempt (AstroLead/WishlistLead status columns,
 * OrderProcessingNotification/OrderProcessingEmailNotification rows) —
 * a recent run of "threw"/"FAILED" entries there is real evidence
 * something's wrong (most often exactly the same Gmail/Interakt issues
 * the System Health page's live checks would also catch), without needing
 * to re-probe those services here too.
 *
 * Every item carries `details`: the actual failures behind it (which order
 * or lead, which service failed, and the error that service returned), so
 * the Overview can say what went wrong and where instead of a generic line.
 */
import prisma from "../db.server";
import { CAN_RETRY, CAN_DISMISS } from "./attentionActions.server";
import { leadNeedsRetry } from "./retryRules";

const SINCE_DAYS = 7;
const MAX_DETAILS = 3;

function hasFailure(status) {
  if (!status) return false;
  return status.startsWith("FAILED") || status.startsWith("threw");
}

/** "FAILED: Interakt HTTP 400 ..." -> "Interakt HTTP 400 ..." (short, single line). */
function cleanReason(status) {
  const text = String(status || "")
    .replace(/^(FAILED|threw)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "No error text was recorded.";
  return text.length > 220 ? text.slice(0, 217) + "…" : text;
}

const SERVICES = {
  whatsapp: "WhatsApp (Interakt)",
  email: "Email (Gmail)",
  astrology: "Birth-chart calculation (AstrologyAPI)",
  shopify: "Shopify customer sync",
  invoice: "Invoice email (Gmail) / PDF",
};

// Where to go to fix each kind of source, shown beside the failure.
const FIXES = {
  [SERVICES.whatsapp]: { href: "/app/settings", label: "Check Settings → Connections and WhatsApp messages" },
  [SERVICES.email]: { href: "/app/settings", label: "Check Settings → Connections (Gmail address and app password)" },
  [SERVICES.astrology]: { href: "/app/server-health", label: "Open System Health" },
  [SERVICES.shopify]: { href: "/app/server-health", label: "Open System Health" },
  [SERVICES.invoice]: { href: "/app/settings", label: "Check Settings → Invoices and Connections" },
};

// `kind` + `id` identify the exact record, so the Overview's Retry / Mark-as-resolved
// buttons (see attentionActions.server.js) know what to act on.
function detail(source, subject, status, when, kind, id) {
  return {
    source,
    subject,
    reason: cleanReason(status),
    when: when ? new Date(when).toISOString() : null,
    fix: FIXES[source] || null,
    kind: kind || null,
    id: id || null,
    canRetry: !!(kind && id && CAN_RETRY.has(kind)),
    canDismiss: !!(kind && id && CAN_DISMISS.has(kind)),
  };
}

function summarise(details) {
  const d = details[0];
  if (!d) return "";
  return `Most recent: ${d.subject} — ${d.source}: ${d.reason}`;
}

function newest(a, b) {
  return new Date(b.when || 0) - new Date(a.when || 0);
}

export async function getAttentionSummary() {
  const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);

  const [astroLeads, wishlistLeads, waNotifications, emailNotifications, returnRefundNotifications, invoices, abandonedEmails] = await Promise.all([
    prisma.astroLead.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true, createdAt: true, calculationOk: true, astroError: true, shopifySyncStatus: true, emailSendStatus: true, whatsappSendStatus: true },
    }),
    prisma.wishlistLead.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, phone: true, createdAt: true, emailSendStatus: true, whatsappSendStatus: true },
    }),
    prisma.orderProcessingNotification.findMany({
      where: { notifiedAt: { gte: since } },
      orderBy: { notifiedAt: "desc" },
      select: { id: true, orderName: true, orderId: true, status: true, notifiedAt: true },
    }),
    prisma.orderProcessingEmailNotification.findMany({
      where: { notifiedAt: { gte: since } },
      orderBy: { notifiedAt: "desc" },
      select: { id: true, orderName: true, orderId: true, status: true, notifiedAt: true },
    }),
    prisma.orderReturnEmailNotification.findMany({
      where: { notifiedAt: { gte: since } },
      orderBy: { notifiedAt: "desc" },
      select: { id: true, orderName: true, orderId: true, status: true, notifiedAt: true },
    }),
    prisma.orderInvoice.findMany({
      where: { lastSentAt: { gte: since } },
      orderBy: { lastSentAt: "desc" },
      select: { id: true, orderName: true, orderId: true, status: true, lastSentAt: true },
    }),
    prisma.abandonedCheckoutEmail.findMany({
      where: { notifiedAt: { gte: since } },
      orderBy: { notifiedAt: "desc" },
      select: { id: true, checkoutName: true, email: true, status: true, notifiedAt: true },
    }),
  ]);

  // ---- Astro leads: say WHICH stage failed (calculation, Shopify sync, email or WhatsApp)
  const astroIssues = astroLeads.filter(
    (l) => !l.calculationOk || hasFailure(l.shopifySyncStatus) || hasFailure(l.emailSendStatus) || hasFailure(l.whatsappSendStatus)
  );
  const astroDetails = astroIssues
    .map((l) => {
      const who = l.name || l.email || "a lead";
      if (!l.calculationOk) return detail(SERVICES.astrology, who, l.astroError || "The birth-chart calculation did not complete.", l.createdAt, "astro-calc", l.id);
      if (hasFailure(l.shopifySyncStatus)) return detail(SERVICES.shopify, who, l.shopifySyncStatus, l.createdAt, "astro-shopify", l.id);
      if (hasFailure(l.emailSendStatus)) return detail(SERVICES.email, who, l.emailSendStatus, l.createdAt, "astro-email", l.id);
      return detail(SERVICES.whatsapp, who, l.whatsappSendStatus, l.createdAt, "astro-whatsapp", l.id);
    })
    .slice(0, MAX_DETAILS);

  // ---- Wishlist leads
  const wishlistIssues = wishlistLeads.filter((l) => hasFailure(l.emailSendStatus) || hasFailure(l.whatsappSendStatus));
  const wishlistDetails = wishlistIssues
    .map((l) =>
      hasFailure(l.emailSendStatus)
        ? detail(SERVICES.email, l.email || "a lead", l.emailSendStatus, l.createdAt, "wishlist-email", l.id)
        : detail(SERVICES.whatsapp, l.email || "a lead", l.whatsappSendStatus, l.createdAt, "wishlist-whatsapp", l.id)
    )
    .slice(0, MAX_DETAILS);

  // ---- Order notifications: WhatsApp and email are separate tables; merge, newest first
  const orderFailureRows = [
    ...waNotifications.filter((n) => hasFailure(n.status)).map((n) => detail(SERVICES.whatsapp, `Order ${n.orderName || n.orderId}`, n.status, n.notifiedAt, "order-whatsapp", n.id)),
    ...emailNotifications.filter((n) => hasFailure(n.status)).map((n) => detail(SERVICES.email, `Order ${n.orderName || n.orderId}`, n.status, n.notifiedAt, "order-email", n.id)),
  ].sort(newest);
  const orderFailures = orderFailureRows;

  const returnRefundIssues = returnRefundNotifications.filter((n) => hasFailure(n.status));
  const returnDetails = returnRefundIssues
    .map((n) => detail(SERVICES.whatsapp, `Order ${n.orderName || n.orderId}`, n.status, n.notifiedAt, "refund", n.id))
    .slice(0, MAX_DETAILS);

  const invoiceIssues = invoices.filter((n) => hasFailure(n.status));
  const invoiceDetails = invoiceIssues
    .map((n) => detail(SERVICES.invoice, `Order ${n.orderName || n.orderId}`, n.status, n.lastSentAt, "invoice", n.id))
    .slice(0, MAX_DETAILS);

  const abandonedIssues = abandonedEmails.filter((n) => hasFailure(n.status));
  const abandonedDetails = abandonedIssues
    .map((n) => detail(SERVICES.email, `Abandoned checkout ${n.checkoutName || ""} (${n.email || "no email"})`.replace("  ", " "), n.status, n.notifiedAt, "abandoned-email", n.id))
    .slice(0, MAX_DETAILS);

  const seenWishlist = new Set();
  const unsentWishlist = [];
  for (const l of wishlistLeads) {
    const key = String(l.email || "").toLowerCase();
    if (!key || seenWishlist.has(key)) continue; // only a customer's newest save is ever messaged
    seenWishlist.add(key);
    if ((l.email && leadNeedsRetry(l.emailSendStatus, l.createdAt)) || (l.phone && leadNeedsRetry(l.whatsappSendStatus, l.createdAt))) unsentWishlist.push(l);
  }
  const unsentAstro = astroLeads.filter(
    (l) => l.calculationOk && ((l.email && leadNeedsRetry(l.emailSendStatus, l.createdAt)) || (l.phone && leadNeedsRetry(l.whatsappSendStatus, l.createdAt)))
  );

  const items = [];
  if (unsentWishlist.length) {
    items.push({
      id: "unsent-wishlist",
      title: `${unsentWishlist.length} wishlist lead${unsentWishlist.length === 1 ? "" : "s"} did not get their reminder`,
      detail: "Their email or WhatsApp message failed, was skipped, or got stuck. Retrying sends only the message that is missing.",
      bulk: { kind: "wishlist", count: unsentWishlist.length },
      href: "/app/wishlist-leads",
      action: "Open Wishlist Leads",
      severity: "warn",
    });
  }
  if (unsentAstro.length) {
    items.push({
      id: "unsent-astro",
      title: `${unsentAstro.length} astro lead${unsentAstro.length === 1 ? "" : "s"} did not get their result`,
      detail: "Their email or WhatsApp message failed, was skipped, or got stuck. Retrying sends only the message that is missing.",
      bulk: { kind: "astro", count: unsentAstro.length },
      href: "/app/astro-leads",
      action: "Open Astro Leads",
      severity: "warn",
    });
  }
  if (orderFailures.length) {
    const details = orderFailureRows.slice(0, MAX_DETAILS);
    items.push({
      id: "order-failures",
      title: `${orderFailures.length} order notification${orderFailures.length === 1 ? "" : "s"} failed recently`,
      detail: summarise(details),
      details,
      href: "/app/whatsapp-events",
      action: "Open Logs",
      severity: "danger",
    });
  }
  if (astroIssues.length) {
    items.push({
      id: "astro-issues",
      title: `${astroIssues.length} astro lead${astroIssues.length === 1 ? "" : "s"} had a problem`,
      detail: summarise(astroDetails),
      details: astroDetails,
      href: "/app/astro-leads",
      action: "Open Astro Leads",
      severity: "danger",
    });
  }
  if (wishlistIssues.length) {
    items.push({
      id: "wishlist-issues",
      title: `${wishlistIssues.length} wishlist lead${wishlistIssues.length === 1 ? "" : "s"} had a problem`,
      detail: summarise(wishlistDetails),
      details: wishlistDetails,
      href: "/app/wishlist-leads",
      action: "Open Wishlist Leads",
      severity: "warn",
    });
  }
  if (returnRefundIssues.length) {
    items.push({
      id: "returns-refunds-issues",
      title: `${returnRefundIssues.length} refund WhatsApp message${returnRefundIssues.length === 1 ? "" : "s"} failed recently`,
      detail: summarise(returnDetails),
      details: returnDetails,
      href: "/app/whatsapp-events",
      action: "Open Logs",
      severity: "danger",
    });
  }
  if (invoiceIssues.length) {
    items.push({
      id: "invoice-issues",
      title: `${invoiceIssues.length} GST invoice${invoiceIssues.length === 1 ? "" : "s"} failed to send recently`,
      detail: summarise(invoiceDetails),
      details: invoiceDetails,
      href: "/app/invoices",
      action: "Open GST Invoices",
      severity: "warn",
    });
  }

  if (abandonedIssues.length) {
    items.push({
      id: "abandoned-issues",
      title: `${abandonedIssues.length} abandoned checkout email${abandonedIssues.length === 1 ? "" : "s"} failed to send`,
      detail: summarise(abandonedDetails),
      details: abandonedDetails,
      href: "/app/whatsapp-events?tab=abandoned",
      action: "Open Logs",
      severity: "warn",
    });
  }

  return {
    items,
    badges: {
      astro: Math.max(astroIssues.length, unsentAstro.length),
      wishlist: Math.max(wishlistIssues.length, unsentWishlist.length),
      whatsapp: orderFailures.length + abandonedIssues.length,
      returnsRefunds: returnRefundIssues.length,
      invoices: invoiceIssues.length,
    },
    healthy: items.length === 0,
  };
}
