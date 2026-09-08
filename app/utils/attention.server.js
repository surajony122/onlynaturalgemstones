/**
 * Cheap, DB-only "does anything need attention right now" signal, shared
 * by the app shell's sidebar (badge counts) and the Overview page's
 * "Needs attention" panel. Deliberately does NOT run the live external
 * checks the Server page does (Gmail SMTP handshake, Shopify Admin API,
 * Interakt key validation, etc.) — those are real network round trips,
 * and this function runs on every single page navigation (it lives in
 * the app.jsx layout loader), so doing that here would slow down every
 * page load and hammer those services on every click through the app.
 *
 * Instead this looks at the last 7 days of DB rows this app already
 * writes on every send attempt (AstroLead/WishlistLead status columns,
 * OrderProcessingNotification/OrderProcessingEmailNotification rows) —
 * a recent run of "threw"/"FAILED" entries there is real evidence
 * something's wrong (most often exactly the same Gmail/Interakt issues
 * the Server page's live checks would also catch), without needing to
 * re-probe those services here too.
 */
import prisma from "../db.server";

const SINCE_DAYS = 7;

function hasFailure(status) {
  if (!status) return false;
  return status.startsWith("FAILED") || status.startsWith("threw");
}

export async function getAttentionSummary() {
  const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);

  const [astroLeads, wishlistLeads, waNotifications, emailNotifications] = await Promise.all([
    prisma.astroLead.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, name: true, email: true, calculationOk: true, shopifySyncStatus: true, emailSendStatus: true, whatsappSendStatus: true },
    }),
    prisma.wishlistLead.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, email: true, emailSendStatus: true, whatsappSendStatus: true },
    }),
    prisma.orderProcessingNotification.findMany({
      where: { notifiedAt: { gte: since } },
      select: { id: true, status: true },
    }),
    prisma.orderProcessingEmailNotification.findMany({
      where: { notifiedAt: { gte: since } },
      select: { id: true, status: true },
    }),
  ]);

  const astroIssues = astroLeads.filter(
    (l) => !l.calculationOk || hasFailure(l.shopifySyncStatus) || hasFailure(l.emailSendStatus) || hasFailure(l.whatsappSendStatus)
  );
  const wishlistIssues = wishlistLeads.filter((l) => hasFailure(l.emailSendStatus) || hasFailure(l.whatsappSendStatus));
  const orderFailures = [
    ...waNotifications.filter((n) => hasFailure(n.status)),
    ...emailNotifications.filter((n) => hasFailure(n.status)),
  ];

  const items = [];
  if (orderFailures.length) {
    items.push({
      id: "order-failures",
      title: `${orderFailures.length} order notification${orderFailures.length === 1 ? "" : "s"} failed recently`,
      detail: `WhatsApp or email send threw an error in the last ${SINCE_DAYS} days — often a Gmail or Interakt configuration issue.`,
      href: "/app/whatsapp-events",
      action: "Open Messages & Orders",
      severity: "danger",
    });
  }
  if (astroIssues.length) {
    items.push({
      id: "astro-issues",
      title: `${astroIssues.length} astro lead${astroIssues.length === 1 ? "" : "s"} had a problem`,
      detail: astroIssues[0]
        ? `Most recent: ${astroIssues[0].name || astroIssues[0].email || "a lead"} — calculation, sync, email, or WhatsApp failed.`
        : "",
      href: "/app/astro-leads",
      action: "Open Astro Leads",
      severity: "danger",
    });
  }
  if (wishlistIssues.length) {
    items.push({
      id: "wishlist-issues",
      title: `${wishlistIssues.length} wishlist lead${wishlistIssues.length === 1 ? "" : "s"} had a problem`,
      detail: wishlistIssues[0] ? `Most recent: ${wishlistIssues[0].email || "a lead"} — email or WhatsApp send failed.` : "",
      href: "/app/wishlist-leads",
      action: "Open Wishlist Leads",
      severity: "warn",
    });
  }

  return {
    items,
    badges: {
      astro: astroIssues.length,
      wishlist: wishlistIssues.length,
      whatsapp: orderFailures.length,
    },
    healthy: items.length === 0,
  };
}
