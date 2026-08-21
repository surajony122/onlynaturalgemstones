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
import { useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendWhatsAppForLead } from "../utils/astroAdvice.server";
import { sendOrderProcessingWhatsApp } from "../utils/interakt.server";
import { resendWishlistWhatsapp } from "../utils/wishlist.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, useSort, SortTh, Pill, RowMenu } from "../components/table-kit";
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

  return { intent, ok: false, error: "Unknown intent" };
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

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

  return {
    messages: enriched,
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
  borderRadius: "6px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  cursor: "pointer",
  marginBottom: "10px",
};

function StatTile({ label, value, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 18px", minWidth: "120px" }}>
      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: color || "#3a2408" }}>{value}</div>
    </div>
  );
}

function MessageRow({ m }) {
  const fetcher = useFetcher();
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

  const deleteEntry = () => {
    if (!window.confirm("Delete this event log entry? This only removes the log row, not the underlying lead/order.")) return;
    fetcher.submit(
      { intent: "delete", messageId: m.messageId, deleteKey: m.messageId, deleteKeyType: m.isRealMessageId ? "messageId" : "id" },
      { method: "POST" }
    );
  };

  const canRetry = m.kind === "Gem Recommendation" || m.kind === "Order Processing" || m.kind === "Wishlist";
  const result = fetcher.data?.messageId === m.messageId ? fetcher.data : null;

  if (result?.intent === "delete" && result.ok) return null; // optimistically hide once deleted

  return (
    <tr className="dt-row" style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={tdStyle}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : "—"}</td>
      <td style={tdStyle}>{m.kind}</td>
      <td style={tdStyle}>
        {m.orderNumber ? `#${m.orderNumber}` : m.kind === "Wishlist" ? (m.wishlistHandle || "—") : m.lead?.name || "—"}
      </td>
      <td style={tdStyle}>{m.lead?.email || m.wishlistLead?.email || "—"}</td>
      <td style={tdStyle}>{m.phone || "—"}</td>
      <td style={tdStyle}>
        {m.lead
          ? [m.lead.lifeStoneGem, m.lead.beneficStoneGem, m.lead.luckyStoneGem].filter(Boolean).join(" / ") || "—"
          : "—"}
      </td>
      <td style={tdStyle} title={m.failureReason || ""}>
        {m.failedAt ? (
          <Pill label="Failed" active color="#d82c0d" />
        ) : m.readAt ? (
          <Pill label="Read" active color="#6b5ce0" />
        ) : m.deliveredAt ? (
          <Pill label="Delivered" active color="#008060" />
        ) : m.sentAt ? (
          <Pill label="Sent" active color="#8c7a4e" />
        ) : (
          <Pill label="—" color="#8c9196" />
        )}
      </td>
      <td style={tdStyle}>{m.deliveredAt ? new Date(m.deliveredAt).toLocaleString() : "—"}</td>
      <td style={tdStyle}>{m.readAt ? new Date(m.readAt).toLocaleString() : "—"}</td>
      <td style={{ ...tdStyle, minWidth: "90px" }}>
        <RowMenu
          items={[
            canRetry && { label: "Retry", onClick: retry, disabled: busy },
            { label: "Delete", onClick: deleteEntry, tone: "danger", disabled: busy },
          ]}
        />
        {result && result.intent !== "delete" && (
          <div style={{ marginTop: "4px", maxWidth: "160px" }}>
            {result.ok ? (
              <span style={{ fontSize: "10px", color: "#008060" }}>Resent</span>
            ) : (
              <FriendlyErrorInline message="Couldn't resend" detail={result.status || result.error} />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

const KIND_OPTIONS = ["All types", "Gem Recommendation", "Order Processing", "Wishlist"];
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
  const { messages, summary } = useLoaderData();
  const revalidator = useRevalidator();
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

  return (
    <s-page heading={`WhatsApp Events (${summary.total})`} width="full">
      <s-section>
        <TableGlobalStyles />
        <button type="button" style={smallBtn} onClick={() => revalidator.revalidate()} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6d7175" }}>
          Real delivered/read status from Interakt's own webhook — Interakt has no API to fetch this, so nothing
          shows here until the webhook is registered (see{" "}
          <s-link href="/app/settings">Settings → Delivery/read tracking</s-link>) and a message has actually gone
          through end to end. Each row's "..." menu has Retry (resend) and Delete (removes this log entry only).
        </p>

        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
          <StatTile label="Total messages" value={summary.total} />
          <StatTile label="Delivered" value={summary.delivered} color="#008060" />
          <StatTile label="Read" value={summary.read} color="#6b5ce0" />
          <StatTile label="Failed" value={summary.failed} color="#d82c0d" />
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search phone, email, name, order #, item…"
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px", minWidth: "240px" }}
          />
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {(searchText || kindFilter !== "All types" || statusFilter !== "all") && (
            <button
              type="button"
              onClick={() => { setSearchText(""); setKindFilter("All types"); setStatusFilter("all"); }}
              style={{ ...smallBtn, marginBottom: 0, fontSize: "12px", padding: "6px 12px" }}
            >
              Clear filters
            </button>
          )}
          <span style={{ fontSize: "12px", color: "#6d7175" }}>
            Showing {filteredMessages.length} of {messages.length}
          </span>
        </div>

        {messages.length === 0 ? (
          <s-paragraph>
            No WhatsApp events logged yet — either the webhook isn't registered yet, or no message has been sent
            since it was.
          </s-paragraph>
        ) : filteredMessages.length === 0 ? (
          <s-paragraph>No events match the current filters.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
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
                  <MessageRow key={m.messageId} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
