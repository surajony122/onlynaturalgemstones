/**
 * Dedicated in-app page for the "order is being processed" email (the
 * counterpart to app.invoices.jsx, same pattern) -- per explicit request
 * ("make a order processing mail where is show all order with their
 * status on also it show status of order processing mail and also we
 * can resend it"). Shows every recent order, whether it carries the
 * processing trigger tag, its fulfillment status, and -- separately --
 * whether/when the processing EMAIL itself was sent for that order, with
 * a Resend button that fires regardless of the automatic trigger
 * conditions (tag / timeline event) checkAndNotifyOrderProcessing()
 * gates on, since a manual resend from this page is an explicit request,
 * not something that needs re-detecting.
 *
 * Each row's "Processing email" status comes from
 * OrderProcessingEmailNotification -- the SAME table the webhook
 * (webhooks.orders.updated.jsx) and the catch-up cron
 * (cron.order-processing-catchup.jsx) already write to, so a row here
 * reflects the real send history regardless of which of those two paths
 * (or a manual resend from this page) actually triggered it. A manual
 * resend logs its own row with a `manual-<timestamp>` triggerKey rather
 * than reusing "tag" or an event timestamp, so it can never collide with
 * the unique([orderId, triggerKey]) constraint those two paths rely on
 * for their own dedup -- this page's resend is a deliberate new
 * occurrence every time, not something that should ever be blocked.
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings, DEFAULT_ORDER_PROCESSING_TRIGGER_TAG } from "../utils/appSettings.server";
import { sendOrderProcessingEmail } from "../utils/orderProcessingEmail.server";
import { brand, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";
import { useToast } from "../components/toast";

const PAGE_SIZE = 25;

async function fetchRecentOrdersForProcessing(admin, first, after) {
  const res = await admin.graphql(
    `#graphql
    query RecentOrdersForProcessing($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          legacyResourceId
          name
          createdAt
          email
          tags
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
    throw new Error(`RecentOrdersForProcessing query failed: ${JSON.stringify(json.errors)}`);
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
  const triggerTag = (settings.orderProcessingTriggerTag || DEFAULT_ORDER_PROCESSING_TRIGGER_TAG).trim().toLowerCase();

  const { orders, pageInfo } = await fetchRecentOrdersForProcessing(admin, PAGE_SIZE, after);

  // One query for every OrderProcessingEmailNotification row touching
  // the orders on this page (latest per order via distinct + orderBy),
  // same "batch instead of per-row" pattern as app.invoices.jsx.
  const orderIds = orders.map((o) => o.legacyResourceId).filter(Boolean);
  const emailNotifications = orderIds.length
    ? await prisma.orderProcessingEmailNotification.findMany({
        where: { shop: session.shop, orderId: { in: orderIds } },
        orderBy: { notifiedAt: "desc" },
        distinct: ["orderId"],
      })
    : [];
  const emailByOrderId = Object.fromEntries(emailNotifications.map((n) => [n.orderId, n]));

  const rows = orders.map((o) => {
    const tagList = (o.tags || []).map((t) => t.trim().toLowerCase());
    const hasTriggerTag = tagList.includes(triggerTag);
    const customerName =
      [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") ||
      o.shippingAddress?.name ||
      "—";
    const emailNotif = emailByOrderId[o.legacyResourceId] || null;
    return {
      gid: o.id,
      orderId: o.legacyResourceId,
      name: o.name,
      createdAt: o.createdAt,
      customerName,
      customerEmail: o.customer?.email || o.email || "—",
      cancelled: !!o.cancelledAt,
      fulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
      hasTriggerTag,
      emailStatus: emailNotif?.status || null,
      emailSentTo: emailNotif?.email || null,
      emailLastSentAt: emailNotif?.notifiedAt || null,
    };
  });

  return { rows, hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor, gmailConfigured, triggerTag };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "resendEmail") {
    const orderGid = formData.get("orderGid");
    const orderId = formData.get("orderId");
    if (!orderGid || !orderId) return { intent, ok: false, error: "Missing order" };

    try {
      // Re-fetched fresh here rather than trusting the page's own (possibly
      // stale, since this action can run well after the page loaded) data
      // -- same reasoning app.invoices.jsx's send action already follows
      // by re-deriving everything server-side instead of trusting the
      // client's copy of an order.
      const res = await admin.graphql(
        `#graphql
        query OrderForProcessingResend($id: ID!) {
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
        return { intent, ok: false, error: `Order lookup failed: ${JSON.stringify(json.errors)}`, orderId };
      }
      const o = json.data?.order;
      if (!o) return { intent, ok: false, error: "Order not found", orderId };

      const settings = await getAppSettings(session.shop);
      const payload = {
        id: o.legacyResourceId,
        name: o.name,
        email: o.email,
        customer: o.customer ? { first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.email } : null,
        shipping_address: o.shippingAddress ? { name: o.shippingAddress.name } : null,
      };

      const result = await sendOrderProcessingEmail(admin, settings, payload);
      const ok = result.startsWith("OK:");

      await prisma.orderProcessingEmailNotification
        .create({
          data: {
            shop: session.shop,
            orderId,
            triggerKey: `manual-${Date.now()}`,
            orderName: o.name,
            email: payload.email,
            status: result,
          },
        })
        .catch((err) => console.error("[app.order-processing] failed to log manual resend:", err));

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

export default function OrderProcessingPage() {
  const data = useLoaderData();
  const resendFetcher = useFetcher();
  const toast = useToast();

  const [filter, setFilter] = useState("");
  // Tracks which order id is mid-resend so only that row's button shows
  // "Sending…" -- resendFetcher is shared across every row's button.
  const [sendingId, setSendingId] = useState(null);

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
    if (resendFetcher.data?.intent === "resendEmail") {
      toast.show(resendFetcher.data.message || resendFetcher.data.error || (resendFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !resendFetcher.data.ok,
      });
      setSendingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendFetcher.data]);

  const handleResend = (row) => {
    setSendingId(row.orderId);
    resendFetcher.submit({ intent: "resendEmail", orderGid: row.gid, orderId: row.orderId }, { method: "POST" });
  };

  const loadMoreHref = data.endCursor ? `?cursor=${encodeURIComponent(data.endCursor)}` : null;

  return (
    <PageIn>
      <PageHeader
        title="Order Processing Emails"
        description={`Every recent order, whether it's tagged "${data.triggerTag}" for the automatic processing notification, and the status of that email — click Resend to send it again regardless.`}
      />

      {!data.gmailConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Gmail isn't connected yet, so processing emails can't be sent — connect it on the{" "}
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
              <th style={thStyle}>Trigger tag</th>
              <th style={thStyle}>Processing email</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>
                  {data.rows.length === 0 ? "No orders found." : "No orders match this filter."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isSending = sendingId === row.orderId && resendFetcher.state !== "idle";
                const alreadySent = row.emailStatus?.startsWith("OK");
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
                      {row.hasTriggerTag ? (
                        <Pill label="Tagged" active color="#2e7d32" />
                      ) : (
                        <span style={{ color: brand.muted, fontSize: "12px" }}>Not tagged</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {row.emailStatus ? (
                        <>
                          <Pill label={alreadySent ? `Sent to ${row.emailSentTo}` : row.emailStatus} active color={alreadySent ? "#2e7d32" : "#c0392b"} />
                          <div style={{ fontSize: "11px", color: brand.muted, marginTop: "3px" }}>
                            {new Date(row.emailLastSentAt).toLocaleString("en-IN")}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: brand.muted, fontSize: "12px" }}>Never sent</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => handleResend(row)}
                        disabled={isSending || !data.gmailConfigured}
                        style={{
                          padding: "7px 14px",
                          borderRadius: "8px",
                          border: "none",
                          background: alreadySent ? brand.panel : brand.accent,
                          color: alreadySent ? brand.body : "#fff",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isSending ? "Sending…" : alreadySent ? "Resend" : "Send"}
                      </button>
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
