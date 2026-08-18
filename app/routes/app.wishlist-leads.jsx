/**
 * Wishlist email + tracking viewer — mirrors app.astro-leads.jsx. Shows
 * WishlistLead rows (most recent first) with rolled-up email status
 * (sent / opened / clicked, and which specific links were clicked)
 * sourced from the same EmailEvent table, matched by trackingId, plus
 * per-lead management: an editable internal note, a "Send Now" button
 * (bypasses the interval check), and a "Delete" button.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { processDueWishlistEmails, resendWishlistLeadEmail, resendWishlistWhatsapp } from "../utils/wishlist.server";

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

  if (intent === "resendWhatsapp") {
    try {
      const status = await resendWishlistWhatsapp(leadId);
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
  const retryWhatsapp = () => fetcher.submit({ intent: "resendWhatsapp", leadId: lead.id }, { method: "POST" });
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
      <td style={td} title={lead.whatsappSendStatus || "pending — not due yet"}>
        {lead.whatsappSendStatus?.startsWith("OK")
          ? statusPill("Sent", true, "#25d366")
          : lead.whatsappSendStatus?.startsWith("skipped")
            ? statusPill("Skipped", true, "#8c9196")
            : lead.whatsappSendStatus
              ? statusPill("Failed", true, "#d82c0d")
              : statusPill("—", false, "#8c9196")}
        <br />
        <button type="button" style={{ ...smallBtn, marginTop: "4px" }} onClick={retryWhatsapp} disabled={busy}>
          {busy && fetcher.formData?.get("intent") === "resendWhatsapp" ? "Sending…" : "Retry"}
        </button>
        {fetcher.data?.intent === "resendWhatsapp" && fetcher.data.leadId === lead.id && (
          <div style={{ fontSize: "10px", marginTop: "3px", color: fetcher.data.ok ? "#008060" : "#d82c0d", whiteSpace: "normal", maxWidth: "160px" }}>
            {fetcher.data.status || fetcher.data.error}
          </div>
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

// Values used both as the <select> option and as the match test below —
// kept in one place so the dropdown and the filter logic can't drift
// out of sync with each other.
const EMAIL_STATUS_OPTIONS = [
  { value: "all", label: "Any email status" },
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "pending", label: "Pending (not due yet)" },
];
const WHATSAPP_STATUS_OPTIONS = [
  { value: "all", label: "Any WhatsApp status" },
  { value: "sent", label: "Sent" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending (not due yet)" },
];

function matchesEmailStatus(lead, filter) {
  if (filter === "all") return true;
  if (filter === "sent") return lead.emailStatus.sent > 0;
  if (filter === "opened") return lead.emailStatus.opened > 0;
  if (filter === "clicked") return lead.emailStatus.clicked > 0;
  if (filter === "pending") return !lead.emailSendStatus;
  return true;
}

function matchesWhatsappStatus(lead, filter) {
  if (filter === "all") return true;
  const status = lead.whatsappSendStatus || "";
  if (filter === "sent") return status.startsWith("OK");
  if (filter === "skipped") return status.startsWith("skipped");
  if (filter === "failed") return !!status && !status.startsWith("OK") && !status.startsWith("skipped");
  if (filter === "pending") return !status;
  return true;
}

export default function WishlistLeadsPage() {
  const { leads } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const isSending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sendDueNow";
  const isRefreshing = revalidator.state === "loading";

  const [searchText, setSearchText] = useState("");
  const [emailFilter, setEmailFilter] = useState("all");
  const [whatsappFilter, setWhatsappFilter] = useState("all");

  const filteredLeads = leads.filter((lead) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (lead.email || "").toLowerCase().includes(q) ||
      (lead.phone || "").toLowerCase().includes(q) ||
      lead.products.some((p) => (p.title || "").toLowerCase().includes(q)) ||
      lead.productHandles.some((h) => (h || "").toLowerCase().includes(q));
    return matchesSearch && matchesEmailStatus(lead, emailFilter) && matchesWhatsappStatus(lead, whatsappFilter);
  });

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
        <button
          type="button"
          onClick={() => revalidator.revalidate()}
          disabled={isRefreshing}
          style={{ ...smallBtn, fontSize: "12px", padding: "6px 14px", marginBottom: "10px" }}
        >
          {isRefreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6d7175" }}>
          Most recent {PAGE_SIZE} wishlist syncs · emails don't send immediately — a customer gets one email once
          they've gone quiet for the interval set on the Settings page (default 2h), using their latest wishlist
          snapshot · each row has its own "Send Now" (email) / "Retry" (WhatsApp) buttons to bypass that, plus
          "Delete" · the wishlist's Shopify tag/note sync is separate and untouched by this.
        </p>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search email, phone, or item…"
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px", minWidth: "220px" }}
          />
          <select
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
          >
            {EMAIL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={whatsappFilter}
            onChange={(e) => setWhatsappFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
          >
            {WHATSAPP_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {(searchText || emailFilter !== "all" || whatsappFilter !== "all") && (
            <button
              type="button"
              onClick={() => { setSearchText(""); setEmailFilter("all"); setWhatsappFilter("all"); }}
              style={{ ...smallBtn, fontSize: "12px", padding: "6px 12px" }}
            >
              Clear filters
            </button>
          )}
          <span style={{ fontSize: "12px", color: "#6d7175" }}>
            Showing {filteredLeads.length} of {leads.length}
          </span>
        </div>

        {leads.length === 0 ? (
          <s-paragraph>No wishlist syncs yet.</s-paragraph>
        ) : filteredLeads.length === 0 ? (
          <s-paragraph>No wishlist syncs match the current filters.</s-paragraph>
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
                  <th style={th}>WhatsApp</th>
                  <th style={th}>Clicked Links</th>
                  <th style={th}>Notes</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
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
