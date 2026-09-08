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

  const [waNotifications, emailNotifications] = await Promise.all([
    prisma.orderProcessingNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: PAGE_SIZE }),
    prisma.orderProcessingEmailNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: PAGE_SIZE }),
  ]);

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
  if (status.startsWith("threw") || status.startsWith("failed to claim")) return { label: "Failed", color: brand.danger };
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
        {g.timeline.map((t, i) => {
          const s = timelineStatusInfo(t.status);
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderTop: i === 0 ? "none" : `1px dashed ${brand.divider}` }}>
              <span style={{ fontSize: "11px", color: brand.faint, minWidth: "150px", fontFamily: brand.mono }}>{new Date(t.notifiedAt).toLocaleString()}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", minWidth: "78px", fontWeight: 500, color: t.channel === "WhatsApp" ? brand.success : brand.accent }}>
                <Icon name={t.channel === "WhatsApp" ? "message" : "mail"} size={12} />
                {t.channel === "WhatsApp" ? "WhatsApp" : "Email"}
              </span>
              <Pill label={s.label} active color={s.color} />
              <span style={{ fontSize: "11.5px", color: brand.faint, flex: 1, wordBreak: "break-word" }} title={t.status || ""}>
                {t.status && t.status.length > 60 ? t.status.slice(0, 60) + "…" : t.status}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
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
// living in this flat table.
const KIND_OPTIONS = ["All types", "Gem Recommendation", "Wishlist"];
const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "sent", label: "Sent only" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "failed", label: "Failed" },
];

function matchesStatus(m, filter) {
  if (filter === "all") return true;
  if (filter === "failed") return !!m.failedAt;
  if (filter === "read") return !!m.readAt;
  if (filter === "delivered") return !!m.deliveredAt;
  if (filter === "sent") return !!m.sentAt;
  return true;
}

export default function WhatsAppEventsPage() {
  const { messages, summary, orderGroups } = useLoaderData();
  const revalidator = useRevalidator();
  const toast = useToast();
  const isRefreshing = revalidator.state === "loading";

  const [searchText, setSearchText] = useState("");
  const [kindFilter, setKindFilter] = useState("All types");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredMessages = messages.filter((m) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (m.phone || "").toLowerCase().includes(q) ||
      (m.lead?.email || m.wishlistLead?.email || "").toLowerCase().includes(q) ||
      (m.lead?.name || "").toLowerCase().includes(q) ||
      (m.orderNumber || "").toLowerCase().includes(q) ||
      (m.wishlistHandle || "").toLowerCase().includes(q);
    const matchesKind = kindFilter === "All types" || m.kind === kindFilter;
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
      <PageHeader title={`Messages & order notifications`} description="Delivered and read status comes straight from Interakt's webhook." />

      <button type="button" onClick={() => revalidator.revalidate()} disabled={isRefreshing} style={{ ...smallBtn, marginBottom: "12px" }}>
        {isRefreshing ? "Refreshing…" : "↻ Refresh"}
      </button>
      <p style={{ margin: "0 0 14px", fontSize: "12.5px", color: brand.muted }}>
        Real delivered/read status from Interakt's own webhook — Interakt has no API to fetch this, so nothing
        shows here until the webhook is registered (see{" "}
        <a href="/app/settings" style={{ color: brand.accent }}>Settings → Delivery/read tracking</a>) and a message
        has actually gone through end to end. Each row's "..." menu has Retry (resend) and Delete (removes this log
        entry only).
      </p>

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <StatTile label="Total messages" value={summary.total} />
        <StatTile label="Delivered" value={summary.delivered} color={brand.success} />
        <StatTile label="Read" value={summary.read} color={brand.accent} />
        <StatTile label="Failed" value={summary.failed} color={brand.danger} />
      </div>

      <OrderProcessingSection orderGroups={orderGroups} />

      <h2 style={{ fontSize: "15px", fontWeight: 700, color: brand.ink, margin: "0 0 12px" }}>Gem Recommendation &amp; Wishlist</h2>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search phone, email, name, order #, item…" style={{ ...inputStyle, minWidth: "240px" }} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ ...inputStyle, minWidth: "auto" }}>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: "auto" }}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {(searchText || kindFilter !== "All types" || statusFilter !== "all") && (
          <button type="button" onClick={() => { setSearchText(""); setKindFilter("All types"); setStatusFilter("all"); }} style={smallBtn}>
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
