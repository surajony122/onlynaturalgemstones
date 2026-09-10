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
 * Two-step flow on purpose: "Find Order" resolves and shows the match
 * (name/customer/total) BEFORE anything is sent, so a merchant typing an
 * order number never risks emailing the wrong order on an ambiguous
 * search match — only "Send Invoice" (a second, explicit click on the
 * already-confirmed order) actually generates/sends anything.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail } from "../utils/orderInvoice.server";
import { brand, Card, PageHeader, PageIn } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const recentInvoices = await prisma.orderInvoice.findMany({
    where: { shop: session.shop },
    orderBy: { lastSentAt: "desc" },
    take: 20,
  });
  return { recentInvoices };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "find") {
    const query = formData.get("orderQuery")?.trim() || "";
    if (!query) return { intent, ok: false, error: "Enter an order number or name" };

    const isNumeric = /^\d+$/.test(query);
    const nameToSearch = query.replace(/^#/, "");

    let orderNode = null;
    try {
      if (isNumeric) {
        const res = await admin.graphql(
          `#graphql
          query OrderById($id: ID!) {
            order(id: $id) { id name customer { firstName lastName email } totalPriceSet { shopMoney { amount currencyCode } } }
          }`,
          { variables: { id: `gid://shopify/Order/${query}` } },
        );
        const json = await res.json();
        orderNode = json.data?.order || null;
      }
      if (!orderNode) {
        const res = await admin.graphql(
          `#graphql
          query OrderByName($q: String!) {
            orders(first: 1, query: $q) {
              nodes { id name customer { firstName lastName email } totalPriceSet { shopMoney { amount currencyCode } } }
            }
          }`,
          { variables: { q: `name:${nameToSearch}` } },
        );
        const json = await res.json();
        orderNode = json.data?.orders?.nodes?.[0] || null;
      }
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err) };
    }

    if (!orderNode) {
      return { intent, ok: false, error: `No order found matching "${query}"` };
    }

    return {
      intent,
      ok: true,
      order: {
        id: orderNode.id,
        name: orderNode.name,
        customerName: [orderNode.customer?.firstName, orderNode.customer?.lastName].filter(Boolean).join(" ") || "—",
        customerEmail: orderNode.customer?.email || "—",
        total: orderNode.totalPriceSet?.shopMoney
          ? `${orderNode.totalPriceSet.shopMoney.currencyCode} ${orderNode.totalPriceSet.shopMoney.amount}`
          : "—",
      },
    };
  }

  if (intent === "send") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName") || "";
    if (!orderId) return { intent, ok: false, error: "Missing order" };

    try {
      const settings = await getAppSettings(session.shop);
      const result = await sendOrderInvoiceEmail(admin, settings, session.shop, orderId);
      const ok = result.startsWith("OK:");
      return { intent, ok, message: result, orderName };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

export default function InvoicesPage() {
  const data = useLoaderData();
  const findFetcher = useFetcher();
  const sendFetcher = useFetcher();
  const toast = useToast();

  const [orderQuery, setOrderQuery] = useState("");
  const [matchedOrder, setMatchedOrder] = useState(null);

  const isFinding = findFetcher.state !== "idle";
  const isSending = sendFetcher.state !== "idle";

  useEffect(() => {
    if (findFetcher.data?.intent === "find") {
      if (findFetcher.data.ok) {
        setMatchedOrder(findFetcher.data.order);
      } else {
        setMatchedOrder(null);
        toast.show(findFetcher.data.error || "Order not found", { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findFetcher.data]);

  useEffect(() => {
    if (sendFetcher.data?.intent === "send") {
      toast.show(sendFetcher.data.message || sendFetcher.data.error || (sendFetcher.data.ok ? "Sent" : "Failed"), {
        isError: !sendFetcher.data.ok,
      });
      if (sendFetcher.data.ok) {
        setMatchedOrder(null);
        setOrderQuery("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendFetcher.data]);

  const handleFind = (e) => {
    e.preventDefault();
    if (!orderQuery.trim()) return;
    setMatchedOrder(null);
    findFetcher.submit({ intent: "find", orderQuery }, { method: "POST" });
  };

  const handleSend = () => {
    if (!matchedOrder) return;
    sendFetcher.submit({ intent: "send", orderId: matchedOrder.id, orderName: matchedOrder.name }, { method: "POST" });
  };

  return (
    <PageIn>
      <PageHeader title="GST Invoices" description="Manually send a GST tax invoice PDF for any order — nothing sends automatically." />

      <Card style={{ marginBottom: "20px" }}>
        <form onSubmit={handleFind} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Order number or name, e.g. 1028 or ONG1028"
            style={{ flex: 1, minWidth: "220px", padding: "10px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px" }}
          />
          <button
            type="submit"
            disabled={isFinding || !orderQuery.trim()}
            style={{ padding: "10px 18px", borderRadius: "9px", border: "none", background: brand.accent, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            {isFinding ? "Finding…" : "Find Order"}
          </button>
        </form>

        {matchedOrder && (
          <div style={{ marginTop: "16px", padding: "14px 16px", border: `1px solid ${brand.accentLine}`, background: brand.accentTint, borderRadius: "10px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", color: brand.heading, marginBottom: "6px" }}>{matchedOrder.name}</div>
            <div style={{ fontSize: "12.5px", color: brand.body, lineHeight: 1.7 }}>
              Customer: {matchedOrder.customerName} ({matchedOrder.customerEmail})<br />
              Total: {matchedOrder.total}
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
              style={{ marginTop: "10px", padding: "9px 16px", borderRadius: "9px", border: "none", background: brand.success, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            >
              {isSending ? "Sending…" : `Send Invoice for ${matchedOrder.name}`}
            </button>
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: brand.heading, margin: "0 0 12px" }}>Recently invoiced orders</h3>
        {data.recentInvoices.length === 0 ? (
          <p style={{ fontSize: "13px", color: brand.muted }}>No invoices sent yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: brand.muted, borderBottom: `1px solid ${brand.divider}` }}>
                <th style={{ padding: "6px 8px" }}>Invoice #</th>
                <th style={{ padding: "6px 8px" }}>Order</th>
                <th style={{ padding: "6px 8px" }}>Sent to</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Last sent</th>
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: `1px solid ${brand.divider}` }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{inv.invoiceNumber}</td>
                  <td style={{ padding: "6px 8px" }}>{inv.orderName || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{inv.sentTo || "—"}</td>
                  <td style={{ padding: "6px 8px", color: inv.status?.startsWith("OK") ? brand.success : brand.danger }}>{inv.status || "—"}</td>
                  <td style={{ padding: "6px 8px", color: brand.muted }}>{new Date(inv.lastSentAt).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageIn>
  );
}
