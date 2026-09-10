/**
 * Dedicated in-app page for sending GST invoices — built after the
 * order-page admin action extension (extensions/order-invoice-action)
 * threw "Failed to fetch" on every attempt (four rebuilds, including one
 * from Shopify's own official generator with a confirmed-correct
 * shopify.auth.idToken() call) — a platform-level restriction on that
 * specific extension surface not worth chasing further right now, per
 * explicit request for a plain in-app page instead.
 *
 * This uses the exact same authenticate.admin(request) pattern every
 * other page in this app (Settings, Server Health, etc.) already uses
 * successfully — no extension sandbox, no cross-origin fetch, no token
 * dance at all, since it's a normal server-rendered page in the same
 * embedded app.
 *
 * Shows every recent order directly, with its GST already computed --
 * per explicit request ("it show all order with items and tax appied
 * and a button to send mail"), not a search-first flow. Each row has
 * its own "Send" button; a small text filter narrows the visible list
 * client-side (name/customer) without a server round trip. "Load more"
 * pages further back with a real GraphQL cursor for shops with more
 * orders than fit in one page.
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail, fetchRecentOrdersForInvoice, computeInvoiceGst } from "../utils/orderInvoice.server";
import { brand, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";
import { useToast } from "../components/toast";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("cursor") || null;

  const settings = await getAppSettings(session.shop);
  const gstConfigured = !!settings.invoiceGstin;
  const gmailConfigured = !!(settings.gmailUser && settings.gmailAppPassword);

  const { orders, pageInfo } = await fetchRecentOrdersForInvoice(admin, PAGE_SIZE, after);

  // One query for every OrderInvoice row touching the orders on this
  // page, rather than one query per row -- keyed by orderId so the
  // table can look up "already sent?" per order in O(1).
  const invoiceRows = await prisma.orderInvoice.findMany({
    where: { shop: session.shop, orderId: { in: orders.map((o) => o.id) } },
  });
  const invoiceByOrderId = Object.fromEntries(invoiceRows.map((row) => [row.orderId, row]));

  const rows = orders.map((order) => {
    const gst = gstConfigured ? computeInvoiceGst(order, settings) : null;
    const customerName =
      [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") ||
      order.billingAddress?.name ||
      order.shippingAddress?.name ||
      "—";
    const invoice = invoiceByOrderId[order.id] || null;
    return {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      customerName,
      customerEmail: order.customer?.email || order.email || "—",
      itemCount: order.lineItems?.nodes?.length || 0,
      itemTitles: (order.lineItems?.nodes || []).map((li) => li.title).join(", "),
      currency: gst?.currency || order.currentSubtotalPriceSet?.shopMoney?.currencyCode || "INR",
      subtotal: gst?.subtotal ?? null,
      totalGst: gst?.totalGst ?? null,
      grandTotal: gst?.grandTotal ?? null,
      invoiceNumber: invoice?.invoiceNumber || null,
      invoiceStatus: invoice?.status || null,
      invoiceSentTo: invoice?.sentTo || null,
      invoiceLastSentAt: invoice?.lastSentAt || null,
    };
  });

  return {
    rows,
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor,
    gstConfigured,
    gmailConfigured,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "send") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName") || "";
    if (!orderId) return { intent, ok: false, error: "Missing order" };

    try {
      const settings = await getAppSettings(session.shop);
      const result = await sendOrderInvoiceEmail(admin, settings, session.shop, orderId);
      const ok = result.startsWith("OK:");
      return { intent, ok, message: result, orderId, orderName };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err), orderId };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

function formatMoney(amount, currency) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency || ""} ${amount.toFixed(2)}`;
  }
}

export default function InvoicesPage() {
  const data = useLoaderData();
  const sendFetcher = useFetcher();
  const toast = useToast();

  const [filter, setFilter] = useState("");
  // Tracks which order id is mid-send so only that row's button shows
  // "Sending…" -- sendFetcher is shared across every row's button.
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
    if (sendFetcher.data?.intent === "send") {
      toast.show(sendFetcher.data.message || sendFetcher.data.error || (sendFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !sendFetcher.data.ok,
      });
      setSendingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendFetcher.data]);

  const handleSend = (row) => {
    setSendingId(row.id);
    sendFetcher.submit({ intent: "send", orderId: row.id, orderName: row.name }, { method: "POST" });
  };

  const loadMoreHref = data.endCursor ? `?cursor=${encodeURIComponent(data.endCursor)}` : null;

  return (
    <PageIn>
      <PageHeader title="GST Invoices" description="Every recent order, with GST already computed — click Send to email a customer their invoice PDF. Nothing sends automatically." />

      {!data.gstConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            GSTIN isn't set yet, so GST can't be computed below — set it on the{" "}
            <a href="/app/settings" style={{ color: brand.accent }}>Settings page</a> (GST Tax Invoice section) first.
          </p>
        </Card>
      )}
      {data.gstConfigured && !data.gmailConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Gmail isn't connected yet, so invoices can't be emailed — connect it on the{" "}
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
              <th style={thStyle}>Items</th>
              <th style={thStyle}>Subtotal</th>
              <th style={thStyle}>GST</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Invoice</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={8}>
                  {data.rows.length === 0 ? "No orders found." : "No orders match this filter."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isSending = sendingId === row.id && sendFetcher.state !== "idle";
                const alreadySent = row.invoiceStatus?.startsWith("OK");
                return (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: brand.heading }}>{row.name}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{new Date(row.createdAt).toLocaleDateString("en-IN")}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.customerName}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{row.customerEmail}</div>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: "220px" }} title={row.itemTitles}>
                      {row.itemCount} {row.itemCount === 1 ? "item" : "items"}
                    </td>
                    <td style={tdStyle}>{formatMoney(row.subtotal, row.currency)}</td>
                    <td style={tdStyle}>{formatMoney(row.totalGst, row.currency)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{formatMoney(row.grandTotal, row.currency)}</td>
                    <td style={tdStyle}>
                      {row.invoiceNumber ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{row.invoiceNumber}</div>
                          <Pill label={alreadySent ? `Sent to ${row.invoiceSentTo}` : row.invoiceStatus || "—"} active color={alreadySent ? "#2e7d32" : "#c0392b"} />
                        </>
                      ) : (
                        <span style={{ color: brand.muted, fontSize: "12px" }}>Not invoiced yet</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => handleSend(row)}
                        disabled={isSending || !data.gstConfigured || !data.gmailConfigured}
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
                        {isSending ? "Sending…" : alreadySent ? "Resend" : "Send Invoice"}
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
