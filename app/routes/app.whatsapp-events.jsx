/**
 * WhatsApp delivery/read tracking — reads WhatsAppMessageEvent rows
 * logged by app/routes/public.interakt-webhook.jsx (Interakt's own
 * webhook, the only source of real sent/delivered/read/failed status —
 * they have no "fetch campaign stats" API). Groups the raw event log by
 * message id into one row per actual WhatsApp message sent, enriched
 * with the AstroLead it belongs to (name/email/recommended stones) via
 * trackingId, parsed from Interakt's callback_data at webhook-receive
 * time.
 *
 * Nothing shows here until the webhook is actually registered in
 * Interakt and a real message has gone all the way through — see the
 * Settings page's "Delivery/read tracking (webhook)" section for setup.
 */
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 500;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const events = await prisma.whatsAppMessageEvent.findMany({
    orderBy: { receivedAt: "asc" },
    take: PAGE_SIZE,
  });

  // Collapse the raw event log (Sent, then Delivered, then Read — up to
  // 4 rows per real message) into one summary row per messageId.
  const byMessage = new Map();
  for (const ev of events) {
    const key = ev.messageId || ev.id;
    if (!byMessage.has(key)) {
      byMessage.set(key, {
        messageId: key,
        trackingId: ev.trackingId || null,
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
        select: { trackingId: true, name: true, email: true, lifeStoneGem: true, beneficStoneGem: true, luckyStoneGem: true },
      })
    : [];
  const leadByTrackingId = Object.fromEntries(leads.map((l) => [l.trackingId, l]));

  const enriched = messages.map((m) => ({
    ...m,
    sentAt: m.sentAt ? m.sentAt.toISOString() : null,
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    failedAt: m.failedAt ? m.failedAt.toISOString() : null,
    lead: leadByTrackingId[m.trackingId] || null,
  }));

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

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", whiteSpace: "nowrap", verticalAlign: "top" };
const smallBtn = {
  fontSize: "12px",
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  cursor: "pointer",
  marginBottom: "10px",
};

function statusPill(label, active, color) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        marginRight: "4px",
        borderRadius: "10px",
        fontSize: "11px",
        fontWeight: 600,
        background: active ? color + "22" : "#f1f2f3",
        color: active ? color : "#8c9196",
      }}
    >
      {label}
    </span>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 18px", minWidth: "120px" }}>
      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: color || "#3a2408" }}>{value}</div>
    </div>
  );
}

export default function WhatsAppEventsPage() {
  const { messages, summary } = useLoaderData();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";

  return (
    <s-page heading={`WhatsApp Events (${summary.total})`} width="full">
      <s-section>
        <button type="button" style={smallBtn} onClick={() => revalidator.revalidate()} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6d7175" }}>
          Real delivered/read status from Interakt's own webhook — Interakt has no API to fetch this, so nothing
          shows here until the webhook is registered (see{" "}
          <s-link href="/app/settings">Settings → Delivery/read tracking</s-link>) and a message has actually gone
          through end to end.
        </p>

        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
          <StatTile label="Total messages" value={summary.total} />
          <StatTile label="Delivered" value={summary.delivered} color="#008060" />
          <StatTile label="Read" value={summary.read} color="#6b5ce0" />
          <StatTile label="Failed" value={summary.failed} color="#d82c0d" />
        </div>

        {messages.length === 0 ? (
          <s-paragraph>
            No WhatsApp events logged yet — either the webhook isn't registered yet, or no message has been sent
            since it was.
          </s-paragraph>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Sent</th>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Life / Benefic / Lucky</th>
                  <th style={th}>Status</th>
                  <th style={th}>Delivered</th>
                  <th style={th}>Read</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.messageId}>
                    <td style={td}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : "—"}</td>
                    <td style={td}>{m.lead?.name || "—"}</td>
                    <td style={td}>{m.lead?.email || "—"}</td>
                    <td style={td}>{m.phone || "—"}</td>
                    <td style={td}>
                      {m.lead
                        ? [m.lead.lifeStoneGem, m.lead.beneficStoneGem, m.lead.luckyStoneGem].filter(Boolean).join(" / ") || "—"
                        : "—"}
                    </td>
                    <td style={td} title={m.failureReason || ""}>
                      {m.failedAt
                        ? statusPill("Failed", true, "#d82c0d")
                        : m.readAt
                          ? statusPill("Read", true, "#6b5ce0")
                          : m.deliveredAt
                            ? statusPill("Delivered", true, "#008060")
                            : m.sentAt
                              ? statusPill("Sent", true, "#8c7a4e")
                              : statusPill("—", false, "#8c9196")}
                    </td>
                    <td style={td}>{m.deliveredAt ? new Date(m.deliveredAt).toLocaleString() : "—"}</td>
                    <td style={td}>{m.readAt ? new Date(m.readAt).toLocaleString() : "—"}</td>
                  </tr>
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
