/**
 * Astro Advice leads + email tracking viewer. Shows the AstroLead rows
 * (most recent first) with a rolled-up email status (sent/opened/clicked,
 * and which specific links were clicked) sourced from EmailEvent rows
 * matched by trackingId, plus per-lead management: an editable internal
 * note, a "Send Now" button (resends the recommendation email), and a
 * "Delete" button.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resendAstroLeadEmail, sendWhatsAppForLead } from "../utils/astroAdvice.server";
import { processWhatsAppQueue, getWhatsAppQueueSummary } from "../utils/whatsappQueue.server";
import { getAppSettings } from "../utils/appSettings.server";

const PAGE_SIZE = 100;

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "processQueue") {
    try {
      const result = await processWhatsAppQueue(admin, session.shop);
      return { intent, ok: true, ...result };
    } catch (err) {
      return { intent, ok: false, error: String(err?.message || err) };
    }
  }

  const leadId = formData.get("leadId");
  if (!leadId) return { intent, ok: false, error: "Missing leadId" };

  if (intent === "sendNow") {
    try {
      const status = await resendAstroLeadEmail(admin, leadId);
      return { intent, ok: status?.startsWith("OK"), leadId, status };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  // Manual retry for a WhatsApp send that failed (or was skipped, or you
  // just want to resend) — mirrors sendNow's shape/pattern exactly, but
  // for sendWhatsAppForLead instead of the email. Reuses the lead's own
  // saved recommendation/dob/tob/etc., so this works even long after the
  // original submission (same as a follow-up reminder would).
  if (intent === "resendWhatsapp") {
    try {
      const lead = await prisma.astroLead.findUnique({ where: { id: leadId } });
      if (!lead) return { intent, ok: false, leadId, error: "Lead not found" };
      const settings = await getAppSettings(lead.shop || session.shop);
      const status = await sendWhatsAppForLead(admin, settings, lead);
      await prisma.astroLead.update({
        where: { id: leadId },
        data: { whatsappSendStatus: status, whatsappFirstSentAt: lead.whatsappFirstSentAt || new Date() },
      });
      return { intent, ok: status?.startsWith("OK"), leadId, status };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  if (intent === "saveNotes") {
    try {
      await prisma.astroLead.update({ where: { id: leadId }, data: { notes: formData.get("notes") || "" } });
      return { intent, ok: true, leadId };
    } catch (err) {
      return { intent, ok: false, leadId, error: String(err?.message || err) };
    }
  }

  if (intent === "delete") {
    try {
      const lead = await prisma.astroLead.findUnique({ where: { id: leadId } });
      await prisma.astroLead.delete({ where: { id: leadId } });
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
  const { session } = await authenticate.admin(request);

  const leads = await prisma.astroLead.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  const whatsappQueue = await getWhatsAppQueueSummary(session.shop);

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
    // detail is "<label> -> <url>" for click events (see track.$type.jsx)
    // — pull just the label out for a compact per-lead list of which
    // specific links were clicked.
    if (ev.event === "clicked" && ev.detail) {
      const label = ev.detail.includes(" -> ") ? ev.detail.split(" -> ")[0] : ev.detail;
      eventsByTrackingId[ev.trackingId].clickedLinks.push(label);
    }
  }

  return {
    leads: leads.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      emailStatus: eventsByTrackingId[l.trackingId] || { sent: 0, opened: 0, clicked: 0, clickedLinks: [] },
    })),
    whatsappQueue,
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
      <td style={td}>{lead.name || "—"}</td>
      <td style={td}>{lead.email || "—"}</td>
      <td style={td}>{lead.phone || "—"}</td>
      <td style={td}>{lead.lifeStoneGem || "—"}</td>
      <td style={td}>
        {lead.calculationOk ? statusPill("OK", true, "#008060") : statusPill("Failed", true, "#d82c0d")}
      </td>
      <td style={td} title={lead.shopifySyncStatus || ""}>
        {(lead.shopifySyncStatus || "").startsWith("OK")
          ? statusPill("Synced", true, "#008060")
          : lead.shopifySyncStatus
            ? statusPill("Failed", true, "#d82c0d")
            : statusPill("—", false, "#8c9196")}
      </td>
      <td style={td} title={lead.emailSendStatus || ""}>
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
      <td style={td} title={lead.whatsappSendStatus || ""}>
        {lead.whatsappSendStatus?.startsWith("OK")
          ? statusPill("Sent", true, "#25d366")
          : lead.whatsappSendStatus?.startsWith("queued")
            ? statusPill("Queued", true, "#b98900")
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

function WhatsAppQueueSection({ whatsappQueue }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.intent === "processQueue" ? fetcher.data : null;

  const processQueue = () => fetcher.submit({ intent: "processQueue" }, { method: "POST" });

  return (
    <s-section heading="WhatsApp follow-up reminders">
      <p style={{ margin: "0 0 8px", fontSize: "13px" }}>
        First message always sends instantly on submission.{" "}
        {whatsappQueue.followUpEnabled ? (
          <>
            Follow-up reminder is <s-text>on</s-text> ({whatsappQueue.pending.length} lead
            {whatsappQueue.pending.length === 1 ? "" : "s"} waiting)
            {whatsappQueue.nextDue ? ` · next due ~${new Date(whatsappQueue.nextDue).toLocaleString()}` : ""}
            {" · "}
            <a href="/app/settings" style={{ color: "#2c6ecb" }}>change in Settings</a>
          </>
        ) : (
          <>
            Follow-up reminder is <s-text>off</s-text>.{" "}
            <a href="/app/settings" style={{ color: "#2c6ecb" }}>turn it on in Settings</a>
          </>
        )}
      </p>
      <button type="button" style={smallBtn} onClick={processQueue} disabled={busy}>
        {busy ? "Checking…" : "Process Follow-ups Now"}
      </button>
      {result && (
        <p style={{ margin: "8px 0 0", fontSize: "12px", color: result.ok ? "#008060" : "#d82c0d" }}>
          {result.ok
            ? result.sent > 0
              ? `Sent ${result.sent} follow-up${result.sent === 1 ? "" : "s"}.`
              : result.note || "Nothing due right now."
            : result.error}
        </p>
      )}
      {whatsappQueue.pending.length > 0 && (
        <div style={{ marginTop: "10px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>First sent</th>
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {whatsappQueue.pending.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{new Date(l.whatsappFirstSentAt).toLocaleString()}</td>
                  <td style={td}>{l.name || "—"}</td>
                  <td style={td}>{l.phone || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </s-section>
  );
}

// Values used both as the <select> option and as the match test below —
// kept in one place so the dropdown and the filter logic can't drift
// out of sync with each other. Same pattern as app.wishlist-leads.jsx.
const CALC_STATUS_OPTIONS = [
  { value: "all", label: "Any calculation status" },
  { value: "ok", label: "OK" },
  { value: "failed", label: "Failed" },
];
const EMAIL_STATUS_OPTIONS = [
  { value: "all", label: "Any email status" },
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "none", label: "Not sent" },
];
const WHATSAPP_STATUS_OPTIONS = [
  { value: "all", label: "Any WhatsApp status" },
  { value: "sent", label: "Sent" },
  { value: "queued", label: "Queued" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "none", label: "Not sent" },
];

function matchesCalcStatus(lead, filter) {
  if (filter === "all") return true;
  if (filter === "ok") return !!lead.calculationOk;
  if (filter === "failed") return !lead.calculationOk;
  return true;
}

function matchesEmailStatus(lead, filter) {
  if (filter === "all") return true;
  if (filter === "sent") return lead.emailStatus.sent > 0;
  if (filter === "opened") return lead.emailStatus.opened > 0;
  if (filter === "clicked") return lead.emailStatus.clicked > 0;
  if (filter === "none") return lead.emailStatus.sent === 0;
  return true;
}

function matchesWhatsappStatus(lead, filter) {
  if (filter === "all") return true;
  const status = lead.whatsappSendStatus || "";
  if (filter === "sent") return status.startsWith("OK");
  if (filter === "queued") return status.startsWith("queued");
  if (filter === "skipped") return status.startsWith("skipped");
  if (filter === "failed") return !!status && !status.startsWith("OK") && !status.startsWith("queued") && !status.startsWith("skipped");
  if (filter === "none") return !status;
  return true;
}

export default function AstroLeadsPage() {
  const { leads, whatsappQueue } = useLoaderData();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";

  const [searchText, setSearchText] = useState("");
  const [calcFilter, setCalcFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  const [whatsappFilter, setWhatsappFilter] = useState("all");

  const filteredLeads = leads.filter((lead) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (lead.name || "").toLowerCase().includes(q) ||
      (lead.email || "").toLowerCase().includes(q) ||
      (lead.phone || "").toLowerCase().includes(q) ||
      (lead.lifeStoneGem || "").toLowerCase().includes(q);
    return (
      matchesSearch &&
      matchesCalcStatus(lead, calcFilter) &&
      matchesEmailStatus(lead, emailFilter) &&
      matchesWhatsappStatus(lead, whatsappFilter)
    );
  });

  return (
    <s-page heading={`Astro Advice — Leads (${leads.length})`} width="full">
      <WhatsAppQueueSection whatsappQueue={whatsappQueue} />
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
          Most recent {PAGE_SIZE} leads · "Opened" is best-effort (some mail clients pre-fetch/block tracking
          images) · "Clicked" is reliable and shows which link on hover · No real "delivered" signal exists · Flow's
          own run history isn't readable via API —{" "}
          <a
            href="https://admin.shopify.com/store/0f9yd0-jr/apps/flow"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2c6ecb" }}
          >
            open Shopify Flow directly
          </a>
          .
        </p>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search name, email, phone, or stone…"
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px", minWidth: "220px" }}
          />
          <select
            value={calcFilter}
            onChange={(e) => setCalcFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #c9cccf", fontSize: "13px" }}
          >
            {CALC_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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
          {(searchText || calcFilter !== "all" || emailFilter !== "all" || whatsappFilter !== "all") && (
            <button
              type="button"
              onClick={() => { setSearchText(""); setCalcFilter("all"); setEmailFilter("all"); setWhatsappFilter("all"); }}
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
          <s-paragraph>No leads yet.</s-paragraph>
        ) : filteredLeads.length === 0 ? (
          <s-paragraph>No leads match the current filters.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Life Stone</th>
                  <th style={th}>Calculation</th>
                  <th style={th}>Shopify Sync</th>
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
