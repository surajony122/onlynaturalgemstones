/**
 * Wishlist email + tracking viewer — mirrors app.astro-leads.jsx. Shows
 * WishlistLead rows (most recent first) with rolled-up email status
 * (sent / opened / clicked, and which specific links were clicked)
 * sourced from the same EmailEvent table, matched by trackingId, plus
 * per-lead management: an editable internal note, a "Send Now" button
 * (bypasses the interval check), and a "Delete" button.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { processDueWishlistEmails, resendWishlistLeadEmail } from "../utils/wishlist.server";

const PAGE_SIZE = 100;

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sendDueNow") {
    try {
      const result = await processDueWishlistEmails(admin, session.shop);
      return { intent, ok: true, ...result };
    } catch (err) {
      return { intent, ok: false, error: String(err?.message || err) };
    }
  }

  const leadId = formData.get("leadId");
  if (!leadId) return { intent, ok: false, error: "Missing leadId" };

  if (intent === "sendNow") {
    try {
      const status = await resendWishlistLeadEmail(admin, leadId);
      return { intent, ok: status?.startsWith("OK"), leadId, status };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  if (intent === "saveNotes") {
    try {
      await prisma.wishlistLead.update({ where: { id: leadId }, data: { notes: formData.get("notes") || "" } });
      return { intent, ok: true, leadId };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  if (intent === "delete") {
    try {
      const lead = await prisma.wishlistLead.findUnique({ where: { id: leadId } });
      await prisma.wishlistLead.delete({ where: { id: leadId } });
      if (lead?.trackingId) {
        await prisma.emailEvent.deleteMany({ where: { trackingId: lead.trackingId } });
      }
      return { intent, ok: true, leadId };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  return { intent, ok: false, error: "Unknown intent" };
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const leads = await prisma.wishlistLead.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  const trackingIds = leads.map((l) => l.trackingId);
  const events = trackingIds.length
    ? await prisma.emailEvent.findMany({ where: { trackingId: { in: trackingIds } } })
    : [];

  const eventsByTrackingId = {};
  for (const ev of events) {
    if (!eventsByTrackingId[ev.trackingId]) {
      eventsByTrackingId[ev.trackingId] = { sent: 0, opened: 0, clicked: 0, clickedLinks: [] };
    }
    if (eventsByTrackingId[ev.trackingId][ev.event] !== undefined) {
      eventsByTrackingId[ev.trackingId][ev.event]++;
    }
    if (ev.event === "clicked" && ev.detail) {
      const label = ev.detail.includes(" -> ") ? ev.detail.split(" -> ")[0] : ev.detail;
      eventsByTrackingId[ev.trackingId].clickedLinks.push(label);
    }
  }

  return {
    leads: leads.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      productHandles: Array.isArray(l.productHandles) ? l.productHandles : [],
      products: Array.isArray(l.products) ? l.products : [],
      emailStatus: eventsByTrackingId[l.trackingId] || { sent: 0, opened: 0, clicked: 0, clickedLinks: [] },
    })),
  };
};

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", whiteSpace: "nowrap", verticalAlign: "top" };
const smallBtn = {
  fontSize: "11px",
  padding: "4px 10px",
  borderRadius: "6px",
  border: "1px solid #c9cccf",
  background: "#ffffff",
  cursor: "pointer",
  marginRight: "4px",
  marginBottom: "4px",
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

function LeadRow({ lead }) {
  const fetcher = useFetcher();
  const [notes, setNotes] = useState(lead.notes || "");
  const [dirty, setDirty] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.intent === "saveNotes" && fetcher.data.ok) setDirty(false);
  }, [fetcher.data]);

  const sendNow = () => fetcher.submit({ intent: "sendNow", leadId: lead.id }, { method: "POST" });
  const saveNotes = () => fetcher.submit({ intent: "saveNotes", leadId: lead.id, notes }, { method: "POST" });
  const deleteLead = () => {
    if (!window.confirm(`Delete this lead (${lead.email || "no email"})? This can't be undone.`)) return;
    fetcher.submit({ intent: "delete", leadId: lead.id }, { method: "POST" });
  };

  if (fetcher.data?.intent === "delete" && fetcher.data.ok && fetcher.data.leadId === lead.id) {
    return null; // optimistically hide once deleted
  }

  return (
    <tr style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={td}>{new Date(lead.createdAt).toLocaleString()}</td>
      <td style={td}>{lead.email || "—"}</td>
      <td style={td}>{lead.phone || "—"}</td>
      <td style={{ ...td, whiteSpace: "normal", minWidth: "260px" }}>
        {lead.products.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {lead.products.map((p) => (
              <div
                key={p.handle}
                title={p.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#faf6f0",
                  border: "1px solid #eadfd2",
                  borderRadius: "8px",
                  padding: "3px 8px 3px 3px",
                }}
              >
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.title}
                    width={28}
                    height={28}
                    style={{ width: 28, height: 28, borderRadius: 5, objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: 5, background: "#eadfd2" }} />
                )}
                <span style={{ fontSize: "11px", color: "#3a2408", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.title}
                </span>
                {p.price ? (
                  <span style={{ fontSize: "11px", color: "#8c7a4e", fontWeight: 600 }}>
                    ₹{Number(p.price).toLocaleString("en-IN")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : lead.productHandles.length ? (
          <span title={lead.productHandles.join(", ")}>
            {lead.productHandles.length} item{lead.productHandles.length === 1 ? "" : "s"} (handles only)
          </span>
        ) : (
          "—"
        )}
      </td>
      <td style={td} title={lead.emailSendStatus || "pending — not due yet"}>
        {statusPill("Sent", lead.emailStatus.sent > 0, "#008060")}
        {statusPill(
          "Opened" + (lead.emailStatus.opened > 1 ? ` ×${lead.emailStatus.opened}` : ""),
          lead.emailStatus.opened > 0,
          "#6b5ce0"
        )}
        {statusPill(
          "Clicked" + (lead.emailStatus.clicked > 1 ? ` ×${lead.emailStatus.clicked}` : ""),
          lead.emailStatus.clicked > 0,
          "#2c6ecb"
        )}
      </td>
      <td style={{ ...td, whiteSpace: "normal", minWidth: "180px" }}>
        {lead.emailStatus.clickedLinks?.length
          ? lead.emailStatus.clickedLinks.map((link, i) => (
              <span
                key={i}
                style={{ display: "inline-block", fontSize: "11px", color: "#2c6ecb", background: "#eaf1fa", padding: "2px 7px", borderRadius: "8px", margin: "1px 3px 1px 0" }}
              >
                {link}
              </span>
            ))
          : "—"}
      </td>
      <td style={{ ...td, minWidth: "180px" }}>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          placeholder="Internal note…"
          style={{ width: "100%", minHeight: "50px", fontSize: "12px", padding: "5px", border: "1px solid #c9cccf", borderRadius: "5px", boxSizing: "border-box", resize: "vertical" }}
        />
        {dirty && (
          <button type="button" style={{ ...smallBtn, marginTop: "4px" }} onClick={saveNotes} disabled={busy}>
            Save note
          </button>
        )}
      </td>
      <td style={{ ...td, minWidth: "140px" }}>
        <button type="button" style={smallBtn} onClick={sendNow} disabled={busy}>
          Send Now
        </button>
        <br />
        <button type="button" style={{ ...smallBtn, color: "#d82c0d", borderColor: "#d82c0d" }} onClick={deleteLead} disabled={busy}>
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function WishlistLeadsPage() {
  const { leads } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sendDueNow";

  useEffect(() => {
    if (!fetcher.data || fetcher.data.intent !== "sendDueNow") return;
    if (fetcher.data.ok) {
      shopify.toast.show(`Checked ${fetcher.data.checked} customer(s), sent ${fetcher.data.sent} email(s)`);
    } else {
      shopify.toast.show(fetcher.data.error || "Failed to send", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const sendDueNow = () => fetcher.submit({ intent: "sendDueNow" }, { method: "POST" });

  return (
    <s-page heading={`Wishlist — Leads (${leads.length})`} width="full">
      <s-button slot="primary-action" onClick={sendDueNow} {...(isSending ? { loading: true } : {})}>
        Send Due Emails Now
      </s-button>

      <s-section>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6d7175" }}>
          Most recent {PAGE_SIZE} wishlist syncs · emails don't send immediately — a customer gets one email once
          they've gone quiet for the interval set on the Settings page (default 2h), using their latest wishlist
          snapshot · use each row's "Send Now" to bypass that for one specific lead · the wishlist's Shopify
          tag/note sync is separate and untouched by this.
        </p>

        {leads.length === 0 ? (
          <s-paragraph>No wishlist syncs yet.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Wishlist Items</th>
                  <th style={th}>Email</th>
                  <th style={th}>Clicked Links</th>
                  <th style={th}>Notes</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
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
