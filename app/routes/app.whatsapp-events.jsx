/**
 * WhatsApp delivery/read tracking — reads WhatsAppMessageEvent rows
 * logged by app/routes/public.interakt-webhook.jsx (Interakt's own
 * webhook, the only source of real sent/delivered/read/failed status —
 * they have no "fetch campaign stats" API). Groups the raw event log by
 * message id into one row per actual WhatsApp message sent, enriched
 * with the AstroLead (Gem Recommendation) or WishlistLead (Wishlist) it
 * belongs to, parsed from Interakt's callback_data at webhook-receive
 * time — "astro-<trackingId>", "order-<orderNumber>", or
 * "wishlist-<productHandle>" prefixes distinguish the three send types
 * (see interakt.server.js's three sendXWhatsApp functions).
 *
 * Nothing shows here until the webhook is actually registered in
 * Interakt and a real message has gone all the way through — see the
 * Settings page's "Delivery/read tracking (webhook)" section for setup.
 *
 * Lead management: each row has its own "..." menu with Retry (resend)
 * and Delete (removes this event log entry only — never touches the
 * underlying lead/order). Retry for Gem Recommendation/Wishlist reuses
 * the exact same resend functions those dashboards use, once a matching
 * lead is found (Gem Recommendation via trackingId — exact; Wishlist via
 * phone number — best-effort, since wishlist sends don't carry a
 * trackingId). Order Processing retry re-sends directly from the phone/
 * order-number already stored on this event log row, no DB lookup
 * needed.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendWhatsAppForLead } from "../utils/astroAdvice.server";
import { sendOrderProcessingWhatsApp } from "../utils/interakt.server";
import { resendWishlistWhatsapp } from "../utils/wishlist.server";
import { sendCheckoutNow, classifyLogStatus } from "../utils/abandonedCheckoutEmail.server";
import { runAttentionAction } from "../utils/attentionActions.server";
import {
  tableWrapStyle,
  tableStyle,
  thStyle,
  tdStyle,
  Pill,
  RowMenu,
  Icon,
  useSort,
  SortTh,
  useBulkSelect,
  SelectAllTh,
  BulkActionsBar,
  MultiSelect,
  brand,
  Card,
  PageHeader,
  PageIn,
} from "../components/table-kit";
import { useToast } from "../components/toast";
import { FriendlyErrorInline } from "../components/friendly-error";

const PAGE_SIZE = 500;

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const messageId = formData.get("messageId");

  // Abandoned checkout emails (sent by this app through Gmail): retry a failed one from its saved
  // snapshot, or send one again to a customer who was already emailed.
  if (intent === "abandonedRetry") {
    const r = await runAttentionAction({ admin, shop: session.shop, intent: "retry", kind: "abandoned-email", id: String(formData.get("logId") || "") });
    return { intent, ok: !!r.ok, status: r.status, error: r.ok ? undefined : r.status || r.error };
  }
  if (intent === "abandonedResend") {
    const r = await sendCheckoutNow({ admin, shop: session.shop, checkoutId: String(formData.get("checkoutId") || ""), resend: true });
    return { intent, ok: !!r.ok, status: r.status, error: r.ok ? undefined : r.status };
  }

  if (intent === "retryGemRecommendation") {
    const leadId = formData.get("leadId");
    if (!leadId) return { intent, ok: false, messageId, error: "No matching lead found to resend from" };
    try {
      const lead = await prisma.astroLead.findUnique({ where: { id: leadId } });
      if (!lead) return { intent, ok: false, messageId, error: "Lead not found" };
      const settings = await getAppSettings(lead.shop || session.shop);
      const status = await sendWhatsAppForLead(admin, settings, lead);
      await prisma.astroLead.update({ where: { id: leadId }, data: { whatsappSendStatus: status } });
      return { intent, ok: status?.startsWith("OK"), messageId, status };
    } catch (err) {
      return { intent, ok: false, messageId, error: String(err?.message || err) };
    }
  }

  if (intent === "retryOrderProcessing") {
    const phone = formData.get("phone")?.trim();
    const orderNumber = formData.get("orderNumber")?.trim();
    if (!phone) return { intent, ok: false, messageId, error: "No phone number on this event to resend to" };
    try {
      const settings = await getAppSettings(session.shop);
      const status = await sendOrderProcessingWhatsApp(settings, { phone, firstName: "there", orderNumber, shop: session.shop });
      return { intent, ok: status?.startsWith("OK"), messageId, status };
    } catch (err) {
      return { intent, ok: false, messageId, error: String(err?.message || err) };
    }
  }

  if (intent === "retryWishlist") {
    const leadId = formData.get("leadId");
    if (!leadId) return { intent, ok: false, messageId, error: "No matching wishlist lead found (matched by phone) to resend from" };
    try {
      const status = await resendWishlistWhatsapp(leadId);
      return { intent, ok: status?.startsWith("OK"), messageId, status };
    } catch (err) {
      return { intent, ok: false, messageId, error: String(err?.message || err) };
    }
  }

  // Marks a failed refund WhatsApp notification as resolved WITHOUT
  // resending it -- for a failure that's already understood/fixed (e.g.
  // a stale template name) and not worth re-notifying the customer about
  // days later. Rewrites the row's own status so it stops matching
  // attention.server.js's hasFailure() check (only "FAILED"/"threw"
  // prefixes count), while keeping the original error text for the
  // record instead of erasing it.
  if (intent === "dismissRefundFailure") {
    const notificationId = formData.get("notificationId");
    if (!notificationId) return { intent, ok: false, messageId, error: "Missing notification id" };
    try {
      const existing = await prisma.orderReturnEmailNotification.findUnique({ where: { id: notificationId } });
      if (!existing) return { intent, ok: false, messageId, error: "Notification not found" };
      await prisma.orderReturnEmailNotification.update({
        where: { id: notificationId },
        data: { status: `dismissed by staff (was: ${existing.status || "unknown"})` },
      });
      return { intent, ok: true, messageId, notificationId };
    } catch (err) {
      return { intent, ok: false, messageId, error: String(err?.message || err) };
    }
  }

  if (intent === "delete") {
    const deleteKey = formData.get("deleteKey");
    const deleteKeyType = formData.get("deleteKeyType"); // "messageId" or "id"
    if (!deleteKey || !deleteKeyType) return { intent, ok: false, messageId, error: "Missing delete key" };
    try {
      if (deleteKeyType === "messageId") {
        await prisma.whatsAppMessageEvent.deleteMany({ where: { messageId: deleteKey } });
      } else {
        await prisma.whatsAppMessageEvent.delete({ where: { id: deleteKey } });
      }
      return { intent, ok: true, messageId };
    } catch (err) {
      return { intent, ok: false, messageId, error: String(err?.message || err) };
    }
  }

  // Bulk delete for the "Gem Recommendation & Wishlist" table below --
  // same shape as the single "delete" above but for a whole batch of
  // rows at once. Each entry carries its own deleteKey/deleteKeyType
  // since a row's identity can be either a real messageId (deletes the
  // whole Sent/Delivered/Read group) or the raw event's own id.
  if (intent === "bulkDelete") {
    const items = JSON.parse(formData.get("items") || "[]");
    if (!items.length) return { intent, ok: false, error: "No events selected" };
    try {
      const messageIdKeys = items.filter((i) => i.deleteKeyType === "messageId").map((i) => i.deleteKey);
      const idKeys = items.filter((i) => i.deleteKeyType === "id").map((i) => i.deleteKey);
      if (messageIdKeys.length) {
        await prisma.whatsAppMessageEvent.deleteMany({ where: { messageId: { in: messageIdKeys } } });
      }
      if (idKeys.length) {
        await prisma.whatsAppMessageEvent.deleteMany({ where: { id: { in: idKeys } } });
      }
      return { intent, ok: true, count: items.length };
    } catch (err) {
      return { intent, ok: false, error: String(err?.message || err) };
    }
  }

  return { intent, ok: false, error: "Unknown intent" };
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const events = await prisma.whatsAppMessageEvent.findMany({
    orderBy: { receivedAt: "asc" },
    take: PAGE_SIZE,
  });

  // Collapse the raw event log (Sent, then Delivered, then Read — up to
  // 4 rows per real message) into one summary row per messageId. Falls
  // back to the raw event's own id as the grouping key on the rare
  // event that never got a real messageId — isRealMessageId tracks
  // which case this is, since Delete needs to know whether to delete by
  // messageId (removes the whole group) or by that one row's own id.
  const byMessage = new Map();
  for (const ev of events) {
    const key = ev.messageId || ev.id;
    if (!byMessage.has(key)) {
      byMessage.set(key, {
        messageId: key,
        isRealMessageId: !!ev.messageId,
        trackingId: ev.trackingId || null,
        callbackData: ev.callbackData || null,
        phone: ev.phone || null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        failureReason: null,
      });
    }
    const m = byMessage.get(key);
    if (!m.trackingId && ev.trackingId) m.trackingId = ev.trackingId;
    if (!m.callbackData && ev.callbackData) m.callbackData = ev.callbackData;
    if (!m.phone && ev.phone) m.phone = ev.phone;
    if (ev.eventType === "message_api_sent") m.sentAt = ev.receivedAt;
    else if (ev.eventType === "message_api_delivered") m.deliveredAt = ev.receivedAt;
    else if (ev.eventType === "message_api_read") m.readAt = ev.receivedAt;
    else if (ev.eventType === "message_api_failed") {
      m.failedAt = ev.receivedAt;
      m.failureReason = ev.failureReason;
    }
  }

  const messages = [...byMessage.values()].sort((a, b) => {
    const at = a.sentAt || a.deliveredAt || a.readAt || a.failedAt || 0;
    const bt = b.sentAt || b.deliveredAt || b.readAt || b.failedAt || 0;
    return new Date(bt).getTime() - new Date(at).getTime();
  });

  const trackingIds = [...new Set(messages.map((m) => m.trackingId).filter(Boolean))];
  const leads = trackingIds.length
    ? await prisma.astroLead.findMany({
        where: { trackingId: { in: trackingIds } },
        select: { id: true, trackingId: true, name: true, email: true, lifeStoneGem: true, beneficStoneGem: true, luckyStoneGem: true },
      })
    : [];
  const leadByTrackingId = Object.fromEntries(leads.map((l) => [l.trackingId, l]));

  // Best-effort WishlistLead lookup by phone — wishlist sends don't
  // carry a trackingId (callbackData is "wishlist-<productHandle>", not
  // lead-specific), so phone number is the only link back to a
  // resendable lead. Picks each phone's most recent WishlistLead row.
  const wishlistPhones = [
    ...new Set(
      messages
        .filter((m) => m.callbackData?.startsWith("wishlist-"))
        .map((m) => m.phone)
        .filter(Boolean)
    ),
  ];
  const wishlistLeads = wishlistPhones.length
    ? await prisma.wishlistLead.findMany({
        where: { phone: { in: wishlistPhones } },
        select: { id: true, phone: true, email: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const wishlistLeadByPhone = {};
  for (const l of wishlistLeads) {
    if (!wishlistLeadByPhone[l.phone]) wishlistLeadByPhone[l.phone] = l; // first hit per phone = most recent, since sorted desc
  }

  const enriched = messages.map((m) => {
    // callbackData prefixes distinguish which send path this came from.
    const orderNumber = m.callbackData?.startsWith("order-") ? m.callbackData.slice("order-".length) : null;
    const isWishlist = m.callbackData?.startsWith("wishlist-");
    const wishlistHandle = isWishlist ? m.callbackData.slice("wishlist-".length) : null;
    const wishlistLead = isWishlist && m.phone ? wishlistLeadByPhone[m.phone] || null : null;
    return {
      ...m,
      sentAt: m.sentAt ? m.sentAt.toISOString() : null,
      deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
      readAt: m.readAt ? m.readAt.toISOString() : null,
      failedAt: m.failedAt ? m.failedAt.toISOString() : null,
      lead: leadByTrackingId[m.trackingId] || null,
      wishlistLead,
      wishlistHandle,
      orderNumber,
      kind: orderNumber ? "Order Processing" : m.trackingId ? "Gem Recommendation" : isWishlist ? "Wishlist" : "—",
    };
  });

  // "Order Processing" gets its own order-centric section below instead
  // of sitting as flat one-row-per-message entries in the generic table
  // -- the same order can legitimately fire more than once (a genuinely
  // new "marked as in progress" occurrence notifies again, by design),
  // and a flat list made that read as unrelated duplicate rows instead
  // of the real story: one order, a timeline of attempts. Gem
  // Recommendation / Wishlist don't have that same "same thing fires
  // more than once" pattern, so they keep the existing flat table.
  const otherMessages = enriched.filter((m) => m.kind !== "Order Processing");

  const [waNotifications, emailNotifications, refundWhatsappNotifications] = await Promise.all([
    prisma.orderProcessingNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: PAGE_SIZE }),
    prisma.orderProcessingEmailNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: PAGE_SIZE }),
    // Refund WhatsApp (webhooks.refunds.create.jsx) used to be invisible on
    // this page entirely -- the Overview page's "Needs attention" panel
    // links a failure here, but this query didn't exist, so there was
    // nowhere to actually see the failure's real error text. Filtered to
    // type "refund_whatsapp" since legacy rows here can carry other types
    // (see the model's own comment) that were never sent as WhatsApp.
    prisma.orderReturnEmailNotification.findMany({
      where: { type: "refund_whatsapp" },
      orderBy: { notifiedAt: "desc" },
      take: PAGE_SIZE,
    }),
  ]);

  const abandonedRows = await prisma.abandonedCheckoutEmail.findMany({ orderBy: { notifiedAt: "desc" }, take: 100 });
  const abandoned = abandonedRows.map((r) => {
    const kind = classifyLogStatus(r.status);
    return {
      id: r.id,
      checkoutId: r.checkoutId,
      name: r.checkoutName || "Checkout",
      customer: r.customerName || "",
      email: r.email || "",
      kind,
      reason: String(r.status || "").replace(/^(OK|skipped|dismissed by staff|FAILED|threw)\s*:?\s*/i, "").trim(),
      notifiedAt: r.notifiedAt.toISOString(),
      canRetry: kind === "failed" && !!r.snapshot,
      canResend: kind === "sent",
      // A skipped checkout can still be sent by hand. The app re-checks consent / unsubscribe / later orders first and says so if it still must not go.
      canSendNow: kind === "skipped" && !/do-not-email|unsubscribed|consent/i.test(String(r.status || "")),
    };
  });

  const orderGroups = new Map();
  const ensureGroup = (orderId, orderName) => {
    if (!orderGroups.has(orderId)) {
      orderGroups.set(orderId, { orderId, orderName: orderName || orderId, phone: null, email: null, timeline: [] });
    }
    const g = orderGroups.get(orderId);
    if (orderName) g.orderName = orderName;
    return g;
  };
  for (const n of waNotifications) {
    const g = ensureGroup(n.orderId, n.orderName);
    if (n.phone) g.phone = n.phone;
    g.timeline.push({ channel: "WhatsApp", notifiedAt: n.notifiedAt.toISOString(), status: n.status, triggerKey: n.triggerKey });
  }
  for (const n of emailNotifications) {
    const g = ensureGroup(n.orderId, n.orderName);
    if (n.email) g.email = n.email;
    g.timeline.push({ channel: "Email", notifiedAt: n.notifiedAt.toISOString(), status: n.status, triggerKey: n.triggerKey });
  }
  for (const n of refundWhatsappNotifications) {
    const g = ensureGroup(n.orderId, n.orderName);
    g.timeline.push({ channel: "Refund WhatsApp", notifiedAt: n.notifiedAt.toISOString(), status: n.status, triggerKey: null, notificationId: n.id });
  }

  // Oldest-first WITHIN each order so the timeline reads top-to-bottom
  // the way it actually happened; the orders themselves are sorted by
  // whichever had the most recent activity, so actively-changing orders
  // surface first.
  for (const g of orderGroups.values()) {
    g.timeline.sort((a, b) => new Date(a.notifiedAt).getTime() - new Date(b.notifiedAt).getTime());
  }

  // Live order status (fulfilled/cancelled/etc.) isn't something either
  // notification table stores -- it's the ORDER's own current state,
  // fetched fresh here via one batched GraphQL call (nodes() accepts
  // many ids at once) rather than one request per order.
  const orderIds = [...orderGroups.keys()];
  if (orderIds.length) {
    try {
      const res = await admin.graphql(
        `#graphql
        query OrderStatusesForEventsPage($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              legacyResourceId
              name
              displayFulfillmentStatus
              displayFinancialStatus
              cancelledAt
            }
          }
        }`,
        { variables: { ids: orderIds.map((id) => `gid://shopify/Order/${id}`) } }
      );
      const json = await res.json();
      const nodes = json?.data?.nodes || [];
      for (const node of nodes) {
        if (!node) continue;
        const g = orderGroups.get(String(node.legacyResourceId));
        if (!g) continue;
        g.orderName = node.name || g.orderName;
        g.fulfillmentStatus = node.displayFulfillmentStatus || null;
        g.financialStatus = node.displayFinancialStatus || null;
        g.cancelledAt = node.cancelledAt || null;
      }
    } catch (err) {
      console.error("[app.whatsapp-events] failed to fetch live order statuses:", err);
      // Non-fatal -- the timeline itself (the main point of this
      // section) still renders fine without the live status badge.
    }
  }

  const orderGroupsSorted = [...orderGroups.values()].sort((a, b) => {
    const aLatest = a.timeline[a.timeline.length - 1]?.notifiedAt || "";
    const bLatest = b.timeline[b.timeline.length - 1]?.notifiedAt || "";
    return bLatest.localeCompare(aLatest);
  });

  return {
    messages: otherMessages,
    orderGroups: orderGroupsSorted,
    abandoned,
    summary: {
      total: enriched.length,
      delivered: enriched.filter((m) => m.deliveredAt).length,
      read: enriched.filter((m) => m.readAt).length,
      failed: enriched.filter((m) => m.failedAt).length,
    },
  };
};

const smallBtn = {
  fontSize: "12px",
  padding: "6px 14px",
  borderRadius: "9px",
  border: `1px solid ${brand.border}`,
  background: "#fff",
  cursor: "pointer",
  color: brand.body,
  fontWeight: 500,
};

const inputStyle = {
  padding: "9px 12px",
  borderRadius: "10px",
  border: `1px solid ${brand.border}`,
  fontSize: "12.5px",
  color: brand.ink,
  background: "#fff",
  minWidth: "220px",
};

function StatTile({ label, value, color }) {
  return (
    <Card padding="14px 18px" style={{ minWidth: "120px" }}>
      <div style={{ fontSize: "12.5px", color: brand.muted, marginBottom: "8px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.02em", color: color || brand.ink }}>{value}</div>
    </Card>
  );
}

function MessageRow({ m, selected, onToggleSelect }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";

  const retry = () => {
    if (m.kind === "Gem Recommendation") {
      fetcher.submit({ intent: "retryGemRecommendation", messageId: m.messageId, leadId: m.lead?.id || "" }, { method: "POST" });
    } else if (m.kind === "Order Processing") {
      fetcher.submit(
        { intent: "retryOrderProcessing", messageId: m.messageId, phone: m.phone || "", orderNumber: m.orderNumber || "" },
        { method: "POST" }
      );
    } else if (m.kind === "Wishlist") {
      fetcher.submit({ intent: "retryWishlist", messageId: m.messageId, leadId: m.wishlistLead?.id || "" }, { method: "POST" });
    }
  };

  const confirmDelete = () => {
    setConfirming(false);
    fetcher.submit(
      { intent: "delete", messageId: m.messageId, deleteKey: m.messageId, deleteKeyType: m.isRealMessageId ? "messageId" : "id" },
      { method: "POST" }
    );
    toast.show("Event log entry deleted");
  };

  const canRetry = m.kind === "Gem Recommendation" || m.kind === "Order Processing" || m.kind === "Wishlist";
  const result = fetcher.data?.messageId === m.messageId ? fetcher.data : null;

  if (result?.intent === "delete" && result.ok) return null; // optimistically hide once deleted

  return (
    <tr className="dt-row" style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={tdStyle}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ cursor: "pointer" }} />
      </td>
      <td style={tdStyle}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : "—"}</td>
      <td style={tdStyle}>{m.kind}</td>
      <td style={tdStyle}>
        {m.orderNumber ? `#${m.orderNumber}` : m.kind === "Wishlist" ? (m.wishlistHandle || "—") : m.lead?.name || "—"}
      </td>
      <td style={tdStyle}>{m.lead?.email || m.wishlistLead?.email || "—"}</td>
      <td style={tdStyle}>{m.phone || "—"}</td>
      <td style={tdStyle}>
        {m.lead ? [m.lead.lifeStoneGem, m.lead.beneficStoneGem, m.lead.luckyStoneGem].filter(Boolean).join(" / ") || "—" : "—"}
      </td>
      <td style={tdStyle} title={m.failureReason || ""}>
        {m.failedAt ? (
          <Pill label="Failed" active color={brand.danger} />
        ) : m.readAt ? (
          <Pill label="Read" active color={brand.accent} />
        ) : m.deliveredAt ? (
          <Pill label="Delivered" active color={brand.success} />
        ) : m.sentAt ? (
          <Pill label="Sent" active color={brand.warn} />
        ) : (
          <Pill label="—" color={brand.muted} />
        )}
      </td>
      <td style={tdStyle}>{m.deliveredAt ? new Date(m.deliveredAt).toLocaleString() : "—"}</td>
      <td style={tdStyle}>{m.readAt ? new Date(m.readAt).toLocaleString() : "—"}</td>
      <td style={{ ...tdStyle, minWidth: "150px", textAlign: "right" }}>
        {confirming ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", animation: "ongFade 0.15s ease both" }}>
            <span style={{ fontSize: "12px", color: brand.danger, fontWeight: 600 }}>Delete?</span>
            <button type="button" onClick={confirmDelete} style={{ padding: "5px 11px", borderRadius: "8px", border: "none", background: brand.danger, color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} style={{ padding: "5px 11px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "12px", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <RowMenu
              items={[
                canRetry && { label: "Retry", onClick: retry, disabled: busy },
                { label: "Delete", onClick: () => setConfirming(true), tone: "danger", disabled: busy },
              ]}
            />
            {result && result.intent !== "delete" && (
              <div style={{ marginTop: "4px", maxWidth: "160px", textAlign: "left", marginLeft: "auto" }}>
                {result.ok ? (
                  <span style={{ fontSize: "10px", color: brand.success }}>Resent</span>
                ) : (
                  <FriendlyErrorInline message="Couldn't resend" detail={result.status || result.error} />
                )}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// Live order status -- cancelledAt wins outright (an order can show
// e.g. "UNFULFILLED" and still be cancelled), otherwise mapped from
// GraphQL's displayFulfillmentStatus enum to a friendlier label.
function orderStatusInfo(g) {
  if (g.cancelledAt) return { label: "Cancelled", color: brand.danger };
  const map = {
    FULFILLED: { label: "Fulfilled", color: brand.success },
    PARTIALLY_FULFILLED: { label: "Partially fulfilled", color: brand.warn },
    UNFULFILLED: { label: "Unfulfilled", color: brand.muted },
    ON_HOLD: { label: "On hold", color: brand.warn },
    SCHEDULED: { label: "Scheduled", color: brand.muted },
    IN_PROGRESS: { label: "In progress", color: brand.accent },
    PARTIALLY_FULFILLED_OVERSHOOT: { label: "Overshot fulfillment", color: brand.warn },
    RESTOCKED: { label: "Restocked", color: brand.muted },
    PENDING_FULFILLMENT: { label: "Pending fulfillment", color: brand.muted },
    REQUEST_DECLINED: { label: "Fulfillment declined", color: brand.danger },
  };
  if (g.fulfillmentStatus && map[g.fulfillmentStatus]) return map[g.fulfillmentStatus];
  if (g.fulfillmentStatus) {
    // Unmapped enum value (Shopify adds these occasionally) -- still
    // show something readable instead of silently rendering blank.
    const label = g.fulfillmentStatus.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
    return { label, color: brand.muted };
  }
  return { label: "Unknown", color: brand.faint };
}

// Same "OK/threw/skipped/sending" status-string convention used
// everywhere else this app logs a send outcome (Server page, etc.).
function timelineStatusInfo(status) {
  if (!status) return { label: "—", color: brand.faint };
  if (status.startsWith("OK")) return { label: "Sent", color: brand.success };
  // "FAILED: ..." is the same send-outcome convention used everywhere else
  // (see interakt.server.js's sendInteraktTemplateMessage) but was missing
  // here, so a failed send fell through to the generic muted branch below
  // and showed as raw truncated status text instead of a clear red pill.
  if (status.startsWith("FAILED") || status.startsWith("threw") || status.startsWith("failed to claim")) {
    return { label: "Failed", color: brand.danger };
  }
  if (status.startsWith("dismissed")) return { label: "Dismissed", color: brand.muted };
  if (status.startsWith("skipped")) return { label: "Skipped", color: brand.muted };
  if (status.startsWith("sending")) return { label: "Sending…", color: brand.warn };
  return { label: status.slice(0, 40), color: brand.muted };
}

// One order's full history: current live status up top, then every
// WhatsApp/email attempt ever made for it, oldest first, so it reads
// as an actual timeline of what happened rather than disconnected rows
// -- exactly the case a flat per-message table couldn't show cleanly
// (the same order notifying twice for two genuinely different "marked
// as in progress" occurrences looked like unrelated duplicates before).
function OrderProcessingCard({ g }) {
  const status = orderStatusInfo(g);
  return (
    <Card padding="0" style={{ marginBottom: "12px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", padding: "14px 18px", background: brand.panel, borderBottom: `1px solid ${brand.divider}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "14px", color: brand.ink, fontFamily: brand.mono }}>#{g.orderName}</span>
          <Pill label={status.label} active color={status.color} />
          {g.phone && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: brand.muted, fontFamily: brand.mono }}>
              <Icon name="phone" size={12} /> {g.phone}
            </span>
          )}
          {g.email && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: brand.muted }}>
              <Icon name="mail" size={12} /> {g.email}
            </span>
          )}
        </div>
        <span style={{ fontSize: "11.5px", color: brand.faint }}>
          {g.timeline.length} notification{g.timeline.length === 1 ? "" : "s"} sent
        </span>
      </div>
      <div style={{ padding: "6px 18px 14px" }}>
        {g.timeline.map((t, i) => (
          <TimelineRow key={i} t={t} isFirst={i === 0} />
        ))}
      </div>
    </Card>
  );
}

// One row in an order's timeline. Refund WhatsApp rows that are currently
// failed get a "Mark resolved" action -- for a failure that's already
// understood and fixed (e.g. the stale template name bug), rather than
// silently resending a days-late WhatsApp about an old refund just to
// clear the Overview page's "needs attention" panel.
function TimelineRow({ t, isFirst }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const dismissed = fetcher.data?.intent === "dismissRefundFailure" && fetcher.data?.ok;
  const s = timelineStatusInfo(dismissed ? "dismissed by staff" : t.status);
  const canDismiss = t.channel === "Refund WhatsApp" && t.notificationId && s.label === "Failed" && !dismissed;

  const dismiss = () => {
    fetcher.submit({ intent: "dismissRefundFailure", notificationId: t.notificationId }, { method: "POST" });
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderTop: isFirst ? "none" : `1px dashed ${brand.divider}`, opacity: busy ? 0.6 : 1 }}>
      <span style={{ fontSize: "11px", color: brand.faint, minWidth: "150px", fontFamily: brand.mono }}>{new Date(t.notifiedAt).toLocaleString()}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", minWidth: "110px", fontWeight: 500, color: t.channel === "Email" ? brand.accent : brand.success }}>
        <Icon name={t.channel === "Email" ? "mail" : "message"} size={12} />
        {t.channel}
      </span>
      <Pill label={s.label} active color={s.color} />
      {/* Previously truncated to 60 chars behind a hover tooltip -- hover
          isn't reliable on every device, and this is exactly the text
          needed to diagnose a failure (e.g. Interakt's own error JSON),
          so it's now shown in full and just wraps instead of cutting off. */}
      <span style={{ fontSize: "11.5px", color: brand.faint, flex: 1, wordBreak: "break-word" }}>
        {dismissed ? `dismissed by staff (was: ${t.status})` : t.status}
      </span>
      {canDismiss && (
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          style={{ flexShrink: 0, padding: "4px 10px", borderRadius: "7px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "11px", cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Marking…" : "Mark resolved"}
        </button>
      )}
    </div>
  );
}

function OrderProcessingSection({ orderGroups }) {
  const [q, setQ] = useState("");
  const filtered = orderGroups.filter((g) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    return (
      String(g.orderName).toLowerCase().includes(query) ||
      (g.phone || "").toLowerCase().includes(query) ||
      (g.email || "").toLowerCase().includes(query)
    );
  });

  return (
    <div style={{ marginBottom: "28px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 700, color: brand.ink, margin: "0 0 4px" }}>
        Order Processing ({orderGroups.length} order{orderGroups.length === 1 ? "" : "s"})
      </h2>
      <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 12px" }}>
        One card per order, with its current live status and every "marked as in progress" WhatsApp/email attempt
        ever sent for it — including if it fired more than once for genuinely separate occurrences.
      </p>
      {orderGroups.length > 0 && (
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order #, phone, email…" style={{ ...inputStyle, marginBottom: "12px" }} />
      )}
      {orderGroups.length === 0 ? (
        <p style={{ fontSize: "12.5px", color: brand.muted }}>No order-processing notifications sent yet.</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: "12.5px", color: brand.muted }}>No orders match "{q}".</p>
      ) : (
        filtered.map((g) => <OrderProcessingCard key={g.orderId} g={g} />)
      )}
    </div>
  );
}

// "Order Processing" is deliberately absent here -- it now has its own
// order-centric section (see OrderProcessingSection below) instead of
// living in this flat table. No "all"/"any" pseudo-option any more --
// an EMPTY selection means "no filter" (MultiSelect shows "Any ..."
// itself), and picking more than one value matches ANY of them.
const KIND_OPTIONS = [
  { value: "Gem Recommendation", label: "Gem Recommendation" },
  { value: "Wishlist", label: "Wishlist" },
];
const STATUS_OPTIONS = [
  { value: "sent", label: "Sent only" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "failed", label: "Failed" },
];

function singleStatusMatch(m, value) {
  if (value === "failed") return !!m.failedAt;
  if (value === "read") return !!m.readAt;
  if (value === "delivered") return !!m.deliveredAt;
  if (value === "sent") return !!m.sentAt;
  return true;
}
function matchesStatus(m, filters) {
  return filters.length === 0 || filters.some((f) => singleStatusMatch(m, f));
}

const ABANDONED_TONE = {
  sent: { label: "Email sent", c: "#1e7e34", bg: "#e6f4ea" },
  failed: { label: "Failed", c: "#c5221f", bg: "#fde8e8" },
  skipped: { label: "Not emailed", c: "#5f6368", bg: "#f1f3f4" },
  sending: { label: "Sending", c: "#b06000", bg: "#fef7e0" },
  unknown: { label: "Unknown", c: "#5f6368", bg: "#f1f3f4" },
};

function AbandonedRow({ r }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const res = fetcher.state === "idle" ? fetcher.data : null;
  useEffect(() => {
    if (!res) return;
    if (res.ok) toast.show("Email sent to " + r.email);
    else toast.show(res.error || res.status || "Could not send", { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const tone = ABANDONED_TONE[r.kind] || ABANDONED_TONE.unknown;
  return (
    <tr>
      <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "12px", color: brand.muted }}>{new Date(r.notifiedAt).toLocaleString()}</td>
      <td style={tdStyle}>
        <div style={{ fontWeight: 600, color: brand.ink }}>{r.customer || "Customer"} <span style={{ fontWeight: 400, color: brand.muted }}>· {r.name}</span></div>
        <div style={{ fontSize: "11.5px", color: brand.muted }}>{r.email}</div>
      </td>
      <td style={{ ...tdStyle, maxWidth: "340px" }}>
        <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600, color: tone.c, background: tone.bg }}>{tone.label}</span>
        {r.kind !== "sent" && r.reason && <div style={{ fontSize: "11.5px", color: r.kind === "failed" ? brand.danger : brand.muted, marginTop: "4px", lineHeight: 1.45, wordBreak: "break-word" }}>{r.reason}</div>}
      </td>
      <td style={tdStyle}>
        {r.canRetry && (
          <button type="button" disabled={busy} style={smallBtn} onClick={() => fetcher.submit({ intent: "abandonedRetry", logId: r.id }, { method: "POST" })}>
            {busy ? "Retrying…" : "Retry"}
          </button>
        )}
        {r.canSendNow && (
          <button type="button" disabled={busy} style={smallBtn} onClick={() => fetcher.submit({ intent: "abandonedResend", checkoutId: r.checkoutId }, { method: "POST" })}>
            {busy ? "Sending…" : "Send now"}
          </button>
        )}
        {r.canResend && (
          <button
            type="button"
            disabled={busy}
            style={smallBtn}
            onClick={() => window.confirm("This customer was already emailed. Send the abandoned cart email to " + r.email + " again?") && fetcher.submit({ intent: "abandonedResend", checkoutId: r.checkoutId }, { method: "POST" })}
          >
            {busy ? "Sending…" : "Resend email"}
          </button>
        )}
      </td>
    </tr>
  );
}

function AbandonedEmailSection({ rows }) {
  const sent = rows.filter((r) => r.kind === "sent").length;
  const failed = rows.filter((r) => r.kind === "failed").length;
  return (
    <div style={{ marginBottom: "28px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 700, color: brand.ink, margin: "0 0 4px" }}>Abandoned cart emails</h2>
      <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 12px" }}>
        Reminder emails the app sent to customers who left a checkout ({sent} sent{failed ? `, ${failed} failed` : ""} in the latest {rows.length}). Turn them on or off in Settings → Emails.
      </p>
      {rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No abandoned cart emails yet.</p>
      ) : (
        <div style={{ ...tableWrapStyle, maxHeight: "420px", overflowY: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Email status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <AbandonedRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WhatsAppEventsPage() {
  const { messages, summary, orderGroups, abandoned } = useLoaderData();
  const revalidator = useRevalidator();
  const toast = useToast();

  const [searchText, setSearchText] = useState("");
  const [kindFilter, setKindFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);

  const filteredMessages = messages.filter((m) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (m.phone || "").toLowerCase().includes(q) ||
      (m.lead?.email || m.wishlistLead?.email || "").toLowerCase().includes(q) ||
      (m.lead?.name || "").toLowerCase().includes(q) ||
      (m.orderNumber || "").toLowerCase().includes(q) ||
      (m.wishlistHandle || "").toLowerCase().includes(q);
    const matchesKind = kindFilter.length === 0 || kindFilter.includes(m.kind);
    return matchesSearch && matchesKind && matchesStatus(m, statusFilter);
  });

  const { sorted: sortedMessages, sortKey, sortDir, onSort } = useSort(filteredMessages, "sentAt", "desc");

  const bulk = useBulkSelect(sortedMessages, "messageId");
  const bulkFetcher = useFetcher();
  const bulkBusy = bulkFetcher.state !== "idle";

  useEffect(() => {
    if (bulkFetcher.data?.intent === "bulkDelete" && bulkFetcher.data.ok) {
      const count = bulkFetcher.data.count;
      bulk.clear();
      revalidator.revalidate();
      toast.show(`${count} event${count === 1 ? "" : "s"} deleted`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${bulk.count} selected event${bulk.count === 1 ? "" : "s"}? This only removes the log entries, not the underlying leads/orders.`)) return;
    const items = sortedMessages
      .filter((m) => bulk.isSelected(m.messageId))
      .map((m) => ({ deleteKey: m.messageId, deleteKeyType: m.isRealMessageId ? "messageId" : "id" }));
    bulkFetcher.submit({ intent: "bulkDelete", items: JSON.stringify(items) }, { method: "POST" });
  };

  return (
    <PageIn>
      <PageHeader
        title="Messages & order notifications"
        description="Delivered and read status for every WhatsApp message."
        stats={[
          { label: "Total", value: summary.total },
          { label: "Delivered", value: summary.delivered, tone: "success" },
          { label: "Read", value: summary.read, tone: "accent" },
          { label: "Failed", value: summary.failed, tone: "danger" },
        ]}
        info={
          <>
            <p style={{ margin: "0 0 8px" }}>Delivered and read status comes straight from Interakt's webhook.</p>
            <p style={{ margin: "0 0 8px" }}>
              Nothing shows here until the webhook is set up (see <a href="/app/settings" style={{ color: brand.accent }}>Settings → Connections → WhatsApp — advanced</a>).
            </p>
            <p style={{ margin: 0 }}>A row's "…" menu can retry the message or delete its log entry.</p>
          </>
        }
      />

      <OrderProcessingSection orderGroups={orderGroups} />

      <AbandonedEmailSection rows={abandoned || []} />

      <h2 style={{ fontSize: "15px", fontWeight: 700, color: brand.ink, margin: "0 0 12px" }}>Gem Recommendation &amp; Wishlist</h2>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search phone, email, name, order #, item…" style={{ ...inputStyle, minWidth: "240px" }} />
        <MultiSelect label="type" options={KIND_OPTIONS} selected={kindFilter} onChange={setKindFilter} />
        <MultiSelect label="status" options={STATUS_OPTIONS} selected={statusFilter} onChange={setStatusFilter} />
        {(searchText || kindFilter.length > 0 || statusFilter.length > 0) && (
          <button type="button" onClick={() => { setSearchText(""); setKindFilter([]); setStatusFilter([]); }} style={smallBtn}>
            Clear filters
          </button>
        )}
        <span style={{ fontSize: "12.5px", color: brand.muted, marginLeft: "auto" }}>
          Showing {filteredMessages.length} of {messages.length}
        </span>
      </div>

      <BulkActionsBar count={bulk.count} onDelete={handleBulkDelete} busy={bulkBusy} noun="event" />

      {messages.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>
          No Gem Recommendation or Wishlist WhatsApp events logged yet — either the webhook isn't registered yet, or
          no message has been sent since it was. (Order Processing has its own section above.)
        </p>
      ) : filteredMessages.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No events match the current filters.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
                <SortTh label="Sent" sortKey="sentAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Type" sortKey="kind" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th style={thStyle}>Name / Order # / Item</th>
                <th style={thStyle}>Email</th>
                <SortTh label="Phone" sortKey="phone" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th style={thStyle}>Life / Benefic / Lucky</th>
                <th style={thStyle}>Status</th>
                <SortTh label="Delivered" sortKey="deliveredAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Read" sortKey="readAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {sortedMessages.map((m) => (
                <MessageRow key={m.messageId} m={m} selected={bulk.isSelected(m.messageId)} onToggleSelect={() => bulk.toggle(m.messageId)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
