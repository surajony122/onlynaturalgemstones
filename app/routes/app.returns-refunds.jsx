/**
 * Dedicated in-app page for the manual Return Received / Refund
 * Processed notifications -- the counterpart to the (now-removed)
 * app.order-processing.jsx, same pattern, but per explicit request
 * EVERYTHING here is sent manually only: no webhook, no trigger tag, no
 * automatic detection of anything. Staff pick an order, optionally
 * enter a refund amount, and click one of four buttons -- Email and
 * WhatsApp are independent for both Return and Refund.
 *
 * Deliberately does NOT touch Shopify's own native "Order refund" email
 * (Settings -> Notifications -> Order refund, sent automatically when a
 * refund is processed from Admin) or its separate self-serve Returns
 * notifications (Return created/approved/received, if that feature is
 * used) -- this page's notifications are this app's own, sent
 * independently of whatever Shopify does natively for the same order.
 *
 * Each row's status comes from OrderReturnEmailNotification (see
 * orderReturnEmail.server.js) -- reading back the MOST RECENT row per
 * (orderId, type), type being one of "return_email" / "refund_email" /
 * "return_whatsapp" / "refund_whatsapp" (the table also logs WhatsApp
 * sends, not just email, despite its name -- kept as one table rather
 * than a second one since the shape is identical).
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendReturnReceivedEmail, sendRefundProcessedEmail } from "../utils/orderReturnEmail.server";
import { sendReturnReceivedWhatsApp, sendRefundProcessedWhatsApp } from "../utils/interakt.server";
import { brand, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";
import { useToast } from "../components/toast";

const PAGE_SIZE = 25;

const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  createdAt
  email
  phone
  cancelledAt
  displayFulfillmentStatus
  customer { firstName lastName email phone }
  shippingAddress { name phone }
  billingAddress { phone }
`;

// Same shipping -> customer -> billing -> order-level priority as
// orderProcessingTrigger.server.js's own phone resolution, for the same
// reason: the order-level field is the least reliable of the four.
function resolvePhone(o) {
  if (o.shippingAddress?.phone) return o.shippingAddress.phone;
  if (o.customer?.phone) return o.customer.phone;
  if (o.billingAddress?.phone) return o.billingAddress.phone;
  if (o.phone) return o.phone;
  return null;
}

async function fetchRecentOrdersForReturns(admin, first, after) {
  const res = await admin.graphql(
    `#graphql
    query RecentOrdersForReturns($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes { ${ORDER_FIELDS} }
      }
    }`,
    { variables: { first, after } },
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`RecentOrdersForReturns query failed: ${JSON.stringify(json.errors)}`);
  }
  return {
    orders: json.data?.orders?.nodes || [],
    pageInfo: json.data?.orders?.pageInfo || { hasNextPage: false, endCursor: null },
  };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("cursor") || null;

  const settings = await getAppSettings(session.shop);
  const gmailConfigured = !!(settings.gmailUser && settings.gmailAppPassword);
  const whatsappConfigured = !!settings.interaktApiKey;

  const { orders, pageInfo } = await fetchRecentOrdersForReturns(admin, PAGE_SIZE, after);

  const orderIds = orders.map((o) => o.legacyResourceId).filter(Boolean);
  const notifications = orderIds.length
    ? await prisma.orderReturnEmailNotification.findMany({
        where: { shop: session.shop, orderId: { in: orderIds } },
        orderBy: { notifiedAt: "desc" },
      })
    : [];
  // Latest row per (orderId, type) -- notifications is already newest-first,
  // so the first one seen per key wins.
  const latestByKey = {};
  for (const n of notifications) {
    const key = `${n.orderId}:${n.type}`;
    if (!latestByKey[key]) latestByKey[key] = n;
  }

  const rows = orders.map((o) => {
    const customerName =
      [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") ||
      o.shippingAddress?.name ||
      "—";
    const forType = (type) => {
      const n = latestByKey[`${o.legacyResourceId}:${type}`] || null;
      return { status: n?.status || null, sentAt: n?.notifiedAt || null, amount: n?.amount || null };
    };
    return {
      gid: o.id,
      orderId: o.legacyResourceId,
      name: o.name,
      createdAt: o.createdAt,
      customerName,
      customerEmail: o.customer?.email || o.email || "—",
      customerPhone: resolvePhone(o),
      cancelled: !!o.cancelledAt,
      fulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
      returnEmail: forType("return_email"),
      returnWhatsapp: forType("return_whatsapp"),
      refundEmail: forType("refund_email"),
      refundWhatsapp: forType("refund_whatsapp"),
    };
  });

  return { rows, hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor, gmailConfigured, whatsappConfigured };
};

async function fetchOrderForSend(admin, orderGid) {
  const res = await admin.graphql(
    `#graphql
    query OrderForReturnRefundSend($id: ID!) {
      order(id: $id) { ${ORDER_FIELDS} }
    }`,
    { variables: { id: orderGid } },
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Order lookup failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.order || null;
}

const SEND_INTENTS = {
  sendReturnEmail: { type: "return_email", channel: "email" },
  sendReturnWhatsapp: { type: "return_whatsapp", channel: "whatsapp" },
  sendRefundEmail: { type: "refund_email", channel: "email" },
  sendRefundWhatsapp: { type: "refund_whatsapp", channel: "whatsapp" },
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const spec = SEND_INTENTS[intent];

  if (spec) {
    const orderGid = formData.get("orderGid");
    const orderId = formData.get("orderId");
    const isRefund = spec.type.startsWith("refund_");
    const amount = isRefund ? (formData.get("amount") || "").trim() : null;
    if (!orderGid || !orderId) return { intent, ok: false, error: "Missing order" };
    if (isRefund && !amount) return { intent, ok: false, error: "Enter a refund amount first", orderId };

    try {
      // Re-fetched fresh here rather than trusting the page's own
      // (possibly stale) data -- same reasoning the old order-processing
      // page's resend action followed.
      const o = await fetchOrderForSend(admin, orderGid);
      if (!o) return { intent, ok: false, error: "Order not found", orderId };

      const settings = await getAppSettings(session.shop);
      const firstName = o.customer?.firstName || (o.shippingAddress?.name || "").split(" ")[0] || "there";
      const phone = resolvePhone(o);

      let result;
      if (spec.channel === "email") {
        const payload = {
          id: o.legacyResourceId,
          name: o.name,
          email: o.email,
          customer: o.customer ? { first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.email } : null,
          shipping_address: o.shippingAddress ? { name: o.shippingAddress.name } : null,
        };
        result = isRefund
          ? await sendRefundProcessedEmail(admin, settings, payload, amount)
          : await sendReturnReceivedEmail(admin, settings, payload);
      } else {
        result = isRefund
          ? await sendRefundProcessedWhatsApp(settings, { phone, firstName, orderNumber: o.name, refundAmount: amount })
          : await sendReturnReceivedWhatsApp(settings, { phone, firstName, orderNumber: o.name });
      }
      const ok = result.startsWith("OK:");

      await prisma.orderReturnEmailNotification
        .create({
          data: {
            shop: session.shop,
            orderId,
            type: spec.type,
            orderName: o.name,
            email: spec.channel === "email" ? o.email : null,
            amount: isRefund ? amount : null,
            status: result,
          },
        })
        .catch((err) => console.error("[app.returns-refunds] failed to log send:", err));

      return { intent, ok, message: result, orderId, orderName: o.name };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err), orderId };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

function fulfillmentLabel(status) {
  const map = {
    FULFILLED: { label: "Fulfilled", color: "#2e7d32" },
    UNFULFILLED: { label: "Unfulfilled", color: "#8c7a4e" },
    PARTIAL: { label: "Partially fulfilled", color: "#b8860b" },
    RESTOCKED: { label: "Restocked", color: "#c0392b" },
    SCHEDULED: { label: "Scheduled", color: "#8c7a4e" },
    ON_HOLD: { label: "On hold", color: "#c0392b" },
  };
  return map[status] || { label: status, color: brand.muted };
}

// One small "channel row" per send button -- status pill + last-sent
// time (if ever sent) on top, the actual button below. Used 4 times per
// table row (Return Email / Return WhatsApp / Refund Email / Refund
// WhatsApp), so the same rendering + disabled/label logic lives in one
// place instead of being copy-pasted 4 times with slightly different
// props each time.
function ChannelButton({ label, channelInfo, isSending, disabled, onClick }) {
  const alreadySent = channelInfo.status?.startsWith("OK");
  return (
    <div style={{ marginBottom: "8px" }}>
      {channelInfo.status ? (
        <div style={{ marginBottom: "4px" }}>
          <Pill
            label={alreadySent ? `Sent${channelInfo.amount ? ` (${channelInfo.amount})` : ""}` : channelInfo.status}
            active
            color={alreadySent ? "#2e7d32" : "#c0392b"}
          />
          <div style={{ fontSize: "10.5px", color: brand.muted, marginTop: "2px" }}>
            {new Date(channelInfo.sentAt).toLocaleString("en-IN")}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "11.5px", color: brand.muted, marginBottom: "4px" }}>Never sent</div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={isSending || disabled}
        style={{
          padding: "6px 12px",
          borderRadius: "8px",
          border: "none",
          background: alreadySent ? brand.panel : brand.accent,
          color: alreadySent ? brand.body : "#fff",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isSending ? "Sending…" : alreadySent ? `Resend ${label}` : `Send ${label}`}
      </button>
    </div>
  );
}

export default function ReturnsRefundsPage() {
  const data = useLoaderData();
  const returnEmailFetcher = useFetcher();
  const returnWhatsappFetcher = useFetcher();
  const refundEmailFetcher = useFetcher();
  const refundWhatsappFetcher = useFetcher();
  const toast = useToast();

  const [filter, setFilter] = useState("");
  // Per-row refund amount inputs, keyed by orderId -- shared by both the
  // Refund Email and Refund WhatsApp buttons for that row.
  const [refundAmounts, setRefundAmounts] = useState({});
  const [sendingId, setSendingId] = useState({ intent: null, orderId: null });

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.customerEmail.toLowerCase().includes(q),
    );
  }, [data.rows, filter]);

  // One effect per fetcher (each fires independently), all doing the
  // same thing: toast the result and clear the "this row/button is
  // sending" flag.
  useEffect(() => {
    const d = returnEmailFetcher.data;
    if (d?.intent === "sendReturnEmail") {
      toast.show(d.message || d.error || (d.ok ? "Sent" : "Failed"), { isError: !d.ok });
      setSendingId({ intent: null, orderId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnEmailFetcher.data]);
  useEffect(() => {
    const d = returnWhatsappFetcher.data;
    if (d?.intent === "sendReturnWhatsapp") {
      toast.show(d.message || d.error || (d.ok ? "Sent" : "Failed"), { isError: !d.ok });
      setSendingId({ intent: null, orderId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnWhatsappFetcher.data]);
  useEffect(() => {
    const d = refundEmailFetcher.data;
    if (d?.intent === "sendRefundEmail") {
      toast.show(d.message || d.error || (d.ok ? "Sent" : "Failed"), { isError: !d.ok });
      setSendingId({ intent: null, orderId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundEmailFetcher.data]);
  useEffect(() => {
    const d = refundWhatsappFetcher.data;
    if (d?.intent === "sendRefundWhatsapp") {
      toast.show(d.message || d.error || (d.ok ? "Sent" : "Failed"), { isError: !d.ok });
      setSendingId({ intent: null, orderId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundWhatsappFetcher.data]);

  const send = (fetcher, intent, row, extra) => {
    setSendingId({ intent, orderId: row.orderId });
    fetcher.submit({ intent, orderGid: row.gid, orderId: row.orderId, ...extra }, { method: "POST" });
  };

  const isSending = (intent, orderId) => sendingId.intent === intent && sendingId.orderId === orderId;

  const loadMoreHref = data.endCursor ? `?cursor=${encodeURIComponent(data.endCursor)}` : null;

  return (
    <PageIn>
      <PageHeader
        title="Returns & Refunds"
        description="Every recent order — send a Return Received or Refund Processed notification manually, by email or WhatsApp, whenever you're ready. Nothing here sends automatically."
      />

      {!data.gmailConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Gmail isn't connected yet, so the email buttons below won't work — connect it on the{" "}
            <a href="/app/settings" style={{ color: brand.accent }}>Settings page</a>.
          </p>
        </Card>
      )}
      {!data.whatsappConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Interakt isn't connected yet, so the WhatsApp buttons below won't work — connect it on the{" "}
            <a href="/app/settings" style={{ color: brand.accent }}>Settings page</a>.
          </p>
        </Card>
      )}

      <Card style={{ marginBottom: "16px" }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter this page by order number, customer name or email…"
          style={{ width: "100%", padding: "10px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px", boxSizing: "border-box" }}
        />
      </Card>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Order status</th>
              <th style={thStyle}>Return</th>
              <th style={thStyle}>Refund</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>
                  {data.rows.length === 0 ? "No orders found." : "No orders match this filter."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const fulfillment = fulfillmentLabel(row.fulfillmentStatus);
                const amount = refundAmounts[row.orderId] || "";
                return (
                  <tr key={row.orderId}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: brand.heading }}>{row.name}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{new Date(row.createdAt).toLocaleDateString("en-IN")}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.customerName}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{row.customerEmail}</div>
                      {row.customerPhone && <div style={{ fontSize: "11px", color: brand.muted }}>{row.customerPhone}</div>}
                    </td>
                    <td style={tdStyle}>
                      {row.cancelled ? (
                        <Pill label="Cancelled" active color="#c0392b" />
                      ) : (
                        <Pill label={fulfillment.label} active color={fulfillment.color} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <ChannelButton
                        label="Email"
                        channelInfo={row.returnEmail}
                        isSending={isSending("sendReturnEmail", row.orderId)}
                        disabled={!data.gmailConfigured}
                        onClick={() => send(returnEmailFetcher, "sendReturnEmail", row)}
                      />
                      <ChannelButton
                        label="WhatsApp"
                        channelInfo={row.returnWhatsapp}
                        isSending={isSending("sendReturnWhatsapp", row.orderId)}
                        disabled={!data.whatsappConfigured}
                        onClick={() => send(returnWhatsappFetcher, "sendReturnWhatsapp", row)}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={amount}
                        onChange={(e) => setRefundAmounts((prev) => ({ ...prev, [row.orderId]: e.target.value }))}
                        placeholder="₹ amount"
                        style={{ width: "100px", padding: "5px 8px", borderRadius: "7px", border: `1px solid ${brand.border}`, fontSize: "12px", boxSizing: "border-box", marginBottom: "8px", display: "block" }}
                      />
                      <ChannelButton
                        label="Email"
                        channelInfo={row.refundEmail}
                        isSending={isSending("sendRefundEmail", row.orderId)}
                        disabled={!data.gmailConfigured}
                        onClick={() => send(refundEmailFetcher, "sendRefundEmail", row, { amount })}
                      />
                      <ChannelButton
                        label="WhatsApp"
                        channelInfo={row.refundWhatsapp}
                        isSending={isSending("sendRefundWhatsapp", row.orderId)}
                        disabled={!data.whatsappConfigured}
                        onClick={() => send(refundWhatsappFetcher, "sendRefundWhatsapp", row, { amount })}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {loadMoreHref && (
        <div style={{ marginTop: "14px", textAlign: "center" }}>
          <a
            href={loadMoreHref}
            style={{ display: "inline-block", padding: "9px 18px", borderRadius: "9px", border: `1px solid ${brand.border}`, color: brand.body, fontSize: "13px", fontWeight: 500, textDecoration: "none" }}
          >
            Load more orders
          </a>
        </div>
      )}
    </PageIn>
  );
}
