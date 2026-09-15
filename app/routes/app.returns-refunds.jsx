/**
 * Dedicated in-app page for the manual Return Received / Refund
 * Processed emails -- the counterpart to the (now-removed)
 * app.order-processing.jsx, same pattern, but per explicit request
 * BOTH emails here are sent manually only: no webhook, no trigger tag,
 * no automatic detection of anything. Staff pick an order, optionally
 * enter a refund amount, and click one of two buttons.
 *
 * Deliberately does NOT touch Shopify's own native "Order refund" email
 * (Settings -> Notifications -> Order refund, sent automatically when a
 * refund is processed from Admin) or its separate self-serve Returns
 * notifications (Return created/approved/received, if that feature is
 * used) -- this page's two emails are this app's own, sent independently
 * of whatever Shopify does natively for the same order.
 *
 * Each row's "Return email" / "Refund email" status comes from
 * OrderReturnEmailNotification (see orderReturnEmail.server.js) --
 * reading back the MOST RECENT row per (orderId, type), same "batch
 * instead of per-row" query pattern as app.invoices.jsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendReturnReceivedEmail, sendRefundProcessedEmail } from "../utils/orderReturnEmail.server";
import { brand, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";
import { useToast } from "../components/toast";

const PAGE_SIZE = 25;

async function fetchRecentOrdersForReturns(admin, first, after) {
  const res = await admin.graphql(
    `#graphql
    query RecentOrdersForReturns($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          legacyResourceId
          name
          createdAt
          email
          cancelledAt
          displayFulfillmentStatus
          customer { firstName lastName email }
          shippingAddress { name }
        }
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
    const returnNotif = latestByKey[`${o.legacyResourceId}:return`] || null;
    const refundNotif = latestByKey[`${o.legacyResourceId}:refund`] || null;
    return {
      gid: o.id,
      orderId: o.legacyResourceId,
      name: o.name,
      createdAt: o.createdAt,
      customerName,
      customerEmail: o.customer?.email || o.email || "—",
      cancelled: !!o.cancelledAt,
      fulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
      returnStatus: returnNotif?.status || null,
      returnLastSentAt: returnNotif?.notifiedAt || null,
      refundStatus: refundNotif?.status || null,
      refundLastSentAt: refundNotif?.notifiedAt || null,
      refundLastAmount: refundNotif?.amount || null,
    };
  });

  return { rows, hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor, gmailConfigured };
};

async function fetchOrderForResend(admin, orderGid) {
  const res = await admin.graphql(
    `#graphql
    query OrderForReturnRefundSend($id: ID!) {
      order(id: $id) {
        legacyResourceId
        name
        email
        customer { firstName lastName email }
        shippingAddress { name }
      }
    }`,
    { variables: { id: orderGid } },
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Order lookup failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.order || null;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sendReturnEmail" || intent === "sendRefundEmail") {
    const orderGid = formData.get("orderGid");
    const orderId = formData.get("orderId");
    const amount = intent === "sendRefundEmail" ? (formData.get("amount") || "").trim() : null;
    if (!orderGid || !orderId) return { intent, ok: false, error: "Missing order" };

    try {
      // Re-fetched fresh here rather than trusting the page's own
      // (possibly stale) data -- same reasoning the old order-processing
      // page's resend action followed.
      const o = await fetchOrderForResend(admin, orderGid);
      if (!o) return { intent, ok: false, error: "Order not found", orderId };

      const settings = await getAppSettings(session.shop);
      const payload = {
        id: o.legacyResourceId,
        name: o.name,
        email: o.email,
        customer: o.customer ? { first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.email } : null,
        shipping_address: o.shippingAddress ? { name: o.shippingAddress.name } : null,
      };

      const type = intent === "sendReturnEmail" ? "return" : "refund";
      const result =
        type === "return"
          ? await sendReturnReceivedEmail(admin, settings, payload)
          : await sendRefundProcessedEmail(admin, settings, payload, amount);
      const ok = result.startsWith("OK:");

      await prisma.orderReturnEmailNotification
        .create({
          data: {
            shop: session.shop,
            orderId,
            type,
            orderName: o.name,
            email: payload.email,
            amount: type === "refund" ? amount : null,
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

export default function ReturnsRefundsPage() {
  const data = useLoaderData();
  const returnFetcher = useFetcher();
  const refundFetcher = useFetcher();
  const toast = useToast();

  const [filter, setFilter] = useState("");
  // Per-row refund amount inputs, keyed by orderId -- kept in local state
  // here rather than uncontrolled inputs so "Send Refund Email" can read
  // the current value without a ref per row.
  const [refundAmounts, setRefundAmounts] = useState({});
  const [sendingReturnId, setSendingReturnId] = useState(null);
  const [sendingRefundId, setSendingRefundId] = useState(null);

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

  useEffect(() => {
    if (returnFetcher.data?.intent === "sendReturnEmail") {
      toast.show(returnFetcher.data.message || returnFetcher.data.error || (returnFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !returnFetcher.data.ok,
      });
      setSendingReturnId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnFetcher.data]);

  useEffect(() => {
    if (refundFetcher.data?.intent === "sendRefundEmail") {
      toast.show(refundFetcher.data.message || refundFetcher.data.error || (refundFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !refundFetcher.data.ok,
      });
      setSendingRefundId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundFetcher.data]);

  const handleSendReturn = (row) => {
    setSendingReturnId(row.orderId);
    returnFetcher.submit({ intent: "sendReturnEmail", orderGid: row.gid, orderId: row.orderId }, { method: "POST" });
  };

  const handleSendRefund = (row) => {
    setSendingRefundId(row.orderId);
    refundFetcher.submit(
      { intent: "sendRefundEmail", orderGid: row.gid, orderId: row.orderId, amount: refundAmounts[row.orderId] || "" },
      { method: "POST" },
    );
  };

  const loadMoreHref = data.endCursor ? `?cursor=${encodeURIComponent(data.endCursor)}` : null;

  return (
    <PageIn>
      <PageHeader
        title="Returns & Refunds"
        description="Every recent order — send a Return Received or Refund Processed email manually, whenever you're ready. Nothing here sends automatically."
      />

      {!data.gmailConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Gmail isn't connected yet, so these emails can't be sent — connect it on the{" "}
            <a href="/app/settings" style={{ color: brand.accent }}>Settings page</a> first.
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
              <th style={thStyle}>Return email</th>
              <th style={thStyle}>Refund email</th>
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
                const isSendingReturn = sendingReturnId === row.orderId && returnFetcher.state !== "idle";
                const isSendingRefund = sendingRefundId === row.orderId && refundFetcher.state !== "idle";
                const returnAlreadySent = row.returnStatus?.startsWith("OK");
                const refundAlreadySent = row.refundStatus?.startsWith("OK");
                const fulfillment = fulfillmentLabel(row.fulfillmentStatus);
                return (
                  <tr key={row.orderId}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: brand.heading }}>{row.name}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{new Date(row.createdAt).toLocaleDateString("en-IN")}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.customerName}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{row.customerEmail}</div>
                    </td>
                    <td style={tdStyle}>
                      {row.cancelled ? (
                        <Pill label="Cancelled" active color="#c0392b" />
                      ) : (
                        <Pill label={fulfillment.label} active color={fulfillment.color} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      {row.returnStatus ? (
                        <div style={{ marginBottom: "6px" }}>
                          <Pill label={returnAlreadySent ? "Sent" : row.returnStatus} active color={returnAlreadySent ? "#2e7d32" : "#c0392b"} />
                          <div style={{ fontSize: "11px", color: brand.muted, marginTop: "3px" }}>
                            {new Date(row.returnLastSentAt).toLocaleString("en-IN")}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "12px", color: brand.muted, marginBottom: "6px" }}>Never sent</div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSendReturn(row)}
                        disabled={isSendingReturn || !data.gmailConfigured}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          border: "none",
                          background: returnAlreadySent ? brand.panel : brand.accent,
                          color: returnAlreadySent ? brand.body : "#fff",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isSendingReturn ? "Sending…" : returnAlreadySent ? "Resend" : "Send Return Email"}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {row.refundStatus ? (
                        <div style={{ marginBottom: "6px" }}>
                          <Pill
                            label={refundAlreadySent ? `Sent${row.refundLastAmount ? ` (${row.refundLastAmount})` : ""}` : row.refundStatus}
                            active
                            color={refundAlreadySent ? "#2e7d32" : "#c0392b"}
                          />
                          <div style={{ fontSize: "11px", color: brand.muted, marginTop: "3px" }}>
                            {new Date(row.refundLastSentAt).toLocaleString("en-IN")}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "12px", color: brand.muted, marginBottom: "6px" }}>Never sent</div>
                      )}
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={refundAmounts[row.orderId] || ""}
                          onChange={(e) => setRefundAmounts((prev) => ({ ...prev, [row.orderId]: e.target.value }))}
                          placeholder="₹ amount"
                          style={{ width: "90px", padding: "5px 8px", borderRadius: "7px", border: `1px solid ${brand.border}`, fontSize: "12px", boxSizing: "border-box" }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSendRefund(row)}
                          disabled={isSendingRefund || !data.gmailConfigured}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "8px",
                            border: "none",
                            background: refundAlreadySent ? brand.panel : brand.accent,
                            color: refundAlreadySent ? brand.body : "#fff",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isSendingRefund ? "Sending…" : refundAlreadySent ? "Resend" : "Send Refund Email"}
                        </button>
                      </div>
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
