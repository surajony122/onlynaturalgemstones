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
import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail, fetchRecentOrdersForInvoice, computeInvoiceGst } from "../utils/orderInvoice.server";
import { brand, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill, RowMenu, useBulkSelect, SelectAllTh, BulkBar } from "../components/table-kit";
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

  // Send the invoice email for several orders in one go. Capped (each one
  // renders a PDF in a headless browser), and run one after another so a
  // slow render never overlaps another.
  if (intent === "bulkSend") {
    const ids = JSON.parse(formData.get("orderIds") || "[]").slice(0, 10);
    if (!ids.length) return { intent, ok: false, error: "No orders selected" };
    const settings = await getAppSettings(session.shop);
    const results = [];
    for (const orderId of ids) {
      try {
        const status = await sendOrderInvoiceEmail(admin, settings, session.shop, orderId);
        results.push({ orderId, ok: status.startsWith("OK:"), status });
      } catch (err) {
        results.push({ orderId, ok: false, status: "threw: " + String((err && err.message) || err) });
      }
    }
    return { intent, ok: results.every((x) => x.ok), results, sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length };
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
  const [searchParams] = useSearchParams();
  const sendFetcher = useFetcher();
  const bulkFetcher = useFetcher();
  const revalidator = useRevalidator();
  const toast = useToast();

  const [filter, setFilter] = useState("");
  // Tracks which order id is mid-send so only that row's button shows
  // "Sending…" -- sendFetcher is shared across every row's button.
  const [sendingId, setSendingId] = useState(null);
  // Tracks which order id is mid-download, same pattern as sendingId.
  const [downloadingId, setDownloadingId] = useState(null);

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

  const bulk = useBulkSelect(filteredRows, "id");
  const bulkSending = bulkFetcher.state !== "idle";
  const [bulkDownloading, setBulkDownloading] = useState(false);
  useEffect(() => {
    const d = bulkFetcher.data;
    if (d?.intent !== "bulkSend") return;
    toast.show(d.error || `${d.sent} invoice${d.sent === 1 ? "" : "s"} sent${d.failed ? `, ${d.failed} failed` : ""}`, { isError: !d.ok });
    bulk.clear();
    revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);
  const handleBulkSend = () => {
    const ids = bulk.selectedIds.slice(0, 10);
    const extra = bulk.count > 10 ? ` Only the first 10 of ${bulk.count} will be sent; select the rest afterwards.` : "";
    if (!window.confirm(`Email the invoice to ${ids.length} customer${ids.length === 1 ? "" : "s"}? Invoices already sent will be sent again.${extra}`)) return;
    bulkFetcher.submit({ intent: "bulkSend", orderIds: JSON.stringify(ids) }, { method: "POST" });
  };
  const handleBulkDownload = async () => {
    setBulkDownloading(true);
    for (const row of filteredRows.filter((x) => bulk.selectedIds.includes(x.id))) {
      await handleDownload(row);
    }
    setBulkDownloading(false);
  };

  const handleSend = (row) => {
    setSendingId(row.id);
    sendFetcher.submit({ intent: "send", orderId: row.id, orderName: row.name }, { method: "POST" });
  };

  // A plain <a href> (what this used to be) navigates the browser
  // straight to the Render domain, OUTSIDE the embedded admin iframe's
  // authenticated context -- confirmed live: it returned Shopify's own
  // embedded-app auth "bounce" page (a stub that loads app-bridge.js and
  // expects to redirect) instead of the PDF, since a raw navigation can
  // never carry the session token authenticate.admin() needs. A same-
  // origin fetch() from here runs INSIDE the already-authenticated app
  // page instead (identical auth context to sendFetcher's own POST
  // above, which already works), so it succeeds -- the PDF comes back
  // as a blob, which a temporary, invisible <a download> then saves.
  const handleDownload = async (row) => {
    setDownloadingId(row.id);
    try {
      const res = await fetch(`/app/invoices/download?orderId=${encodeURIComponent(row.id)}`);
      if (!res.ok) {
        const message = await res.text().catch(() => "");
        toast.show(message || `Download failed (${res.status})`, { isError: true });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `${row.invoiceNumber || row.name}.pdf`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.show(String(err.message || err), { isError: true });
    } finally {
      setDownloadingId(null);
    }
  };

  // In-app navigation (a plain <a href> reloads the whole page outside the embedded
  // admin's login, which showed an error). Keeps the existing URL parameters.
  const loadMoreHref = (() => {
    if (!data.endCursor) return null;
    const next = new URLSearchParams(searchParams);
    next.set("cursor", data.endCursor);
    return "?" + next.toString();
  })();

  return (
    <PageIn>
      <PageHeader
        title="GST Invoices"
        description="Every recent order, with GST already computed."
        stats={[{ label: "Orders shown", value: data.rows.length }]}
        info={
          <p style={{ margin: 0 }}>
            Click Send to email a customer their invoice PDF, or Download PDF to save it yourself. Nothing sends automatically.
          </p>
        }
      />

      {!data.gstConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            GSTIN isn't set yet, so GST can't be computed below — set it on the{" "}
            <Link to="/app/settings" style={{ color: brand.accent }}>Settings page</Link> (GST Tax Invoice section) first.
          </p>
        </Card>
      )}
      {data.gstConfigured && !data.gmailConfigured && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Gmail isn't connected yet, so invoices can't be emailed — connect it on the{" "}
            <Link to="/app/settings" style={{ color: brand.accent }}>Settings page</Link> first.
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

      <BulkBar count={bulk.count} noun="order">
        <button
          type="button"
          onClick={handleBulkSend}
          disabled={bulkSending || !data.gstConfigured || !data.gmailConfigured}
          style={{ fontSize: "12px", fontWeight: 600, color: "#fff", background: brand.accent, border: "none", borderRadius: "8px", padding: "6px 14px", cursor: bulkSending ? "default" : "pointer", opacity: bulkSending ? 0.6 : 1 }}
        >
          {bulkSending ? "Sending…" : `Send invoices (${Math.min(bulk.count, 10)})`}
        </button>
        <button
          type="button"
          onClick={handleBulkDownload}
          disabled={bulkDownloading || !data.gstConfigured}
          style={{ fontSize: "12px", fontWeight: 600, color: brand.body, background: "#fff", border: `1px solid ${brand.border}`, borderRadius: "8px", padding: "6px 14px", cursor: bulkDownloading ? "default" : "pointer", opacity: bulkDownloading ? 0.6 : 1 }}
        >
          {bulkDownloading ? "Downloading…" : "Download PDFs"}
        </button>
        <button type="button" onClick={bulk.clear} style={{ marginLeft: "auto", fontSize: "12px", color: brand.muted, background: "none", border: "none", cursor: "pointer" }}>
          Clear selection
        </button>
      </BulkBar>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Invoice</th>
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
                const isSending = sendingId === row.id && sendFetcher.state !== "idle";
                const isDownloading = downloadingId === row.id;
                const alreadySent = row.invoiceStatus?.startsWith("OK");
                return (
                  <tr key={row.id} className="dt-row">
                    <td style={tdStyle}>
                      <input type="checkbox" checked={bulk.isSelected(row.id)} onChange={() => bulk.toggle(row.id)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: brand.heading }}>{row.name}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{new Date(row.createdAt).toLocaleDateString("en-IN")}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.customerName}</div>
                      <div style={{ fontSize: "11px", color: brand.muted, wordBreak: "break-all" }}>{row.customerEmail}</div>
                    </td>
                    <td style={{ ...tdStyle, minWidth: "170px" }} title={row.itemTitles}>
                      <div style={{ fontWeight: 600, color: brand.ink }}>{formatMoney(row.grandTotal, row.currency)}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>
                        Subtotal {formatMoney(row.subtotal, row.currency)} · GST {formatMoney(row.totalGst, row.currency)}
                      </div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>
                        {row.itemCount} {row.itemCount === 1 ? "item" : "items"}
                      </div>
                    </td>
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
                    <td style={{ ...tdStyle, minWidth: "90px", textAlign: "right" }}>
                      {/* Download runs a same-origin fetch from handleDownload (a plain link
                          would leave the embedded admin's authenticated context and hit
                          Shopify's auth bounce page instead of the PDF -- see handleDownload). */}
                      <RowMenu
                        items={[
                          { label: isSending ? "Sending…" : alreadySent ? "Resend invoice" : "Send invoice", onClick: () => handleSend(row), disabled: isSending || !data.gstConfigured || !data.gmailConfigured },
                          { label: isDownloading ? "Downloading…" : "Download PDF", onClick: () => handleDownload(row), disabled: isDownloading || !data.gstConfigured },
                        ]}
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
          <Link
            to={loadMoreHref}
            style={{ display: "inline-block", padding: "9px 18px", borderRadius: "9px", border: `1px solid ${brand.border}`, color: brand.body, fontSize: "13px", fontWeight: 500, textDecoration: "none" }}
          >
            Load more orders
          </Link>
        </div>
      )}
    </PageIn>
  );
}
