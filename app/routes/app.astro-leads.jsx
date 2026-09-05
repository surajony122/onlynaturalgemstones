/**
 * Astro Advice leads + email tracking viewer. Shows the AstroLead rows
 * (most recent first) with a rolled-up email status (sent/opened/clicked,
 * and which specific links were clicked) sourced from EmailEvent rows
 * matched by trackingId, plus per-lead management: an editable internal
 * note and a "..." row-actions menu (Send Now / Retry WhatsApp / Delete).
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resendAstroLeadEmail, sendWhatsAppForLead } from "../utils/astroAdvice.server";
import { processWhatsAppQueue, getWhatsAppQueueSummary } from "../utils/whatsappQueue.server";
import { getAppSettings } from "../utils/appSettings.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, useSort, SortTh, Pill, RowMenu } from "../components/table-kit";
import { FriendlyErrorInline } from "../components/friendly-error";

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

const smallBtn = {
  fontSize: "11px",
  padding: "4px 10px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  background: "#ffffff",
  cursor: "pointer",
  marginRight: "4px",
  marginBottom: "4px",
};

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

  const lastActionResult =
    fetcher.data && ["sendNow", "resendWhatsapp"].includes(fetcher.data.intent) && fetcher.data.leadId === lead.id
      ? fetcher.data
      : null;

  return (
    <tr className="dt-row" style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={tdStyle}>{new Date(lead.createdAt).toLocaleString()}</td>
      <td style={tdStyle}>{lead.name || "—"}</td>
      <td style={tdStyle}>{lead.email || "—"}</td>
      <td style={tdStyle}>{lead.phone || "—"}</td>
      <td style={tdStyle}>{lead.lifeStoneGem || "—"}</td>
      <td style={tdStyle}>
        {lead.calculationOk ? <Pill label="OK" active color="#16A34A" /> : <Pill label="Failed" active color="#DC2626" />}
      </td>
      <td style={tdStyle} title={lead.shopifySyncStatus || ""}>
        {(lead.shopifySyncStatus || "").startsWith("OK") ? (
          <Pill label="Synced" active color="#16A34A" />
        ) : lead.shopifySyncStatus ? (
          <Pill label="Failed" active color="#DC2626" />
        ) : (
          <Pill label="—" color="#6B7280" />
        )}
      </td>
      <td style={tdStyle} title={lead.emailSendStatus || ""}>
        <Pill label="Sent" active={lead.emailStatus.sent > 0} color="#16A34A" />
        <Pill
          label={"Opened" + (lead.emailStatus.opened > 1 ? ` ×${lead.emailStatus.opened}` : "")}
          active={lead.emailStatus.opened > 0}
          color="#6b5ce0"
        />
        <Pill
          label={"Clicked" + (lead.emailStatus.clicked > 1 ? ` ×${lead.emailStatus.clicked}` : "")}
          active={lead.emailStatus.clicked > 0}
          color="#2563EB"
        />
      </td>
      <td style={tdStyle} title={lead.whatsappSendStatus || ""}>
        {lead.whatsappSendStatus?.startsWith("OK") ? (
          <Pill label="Sent" active color="#25d366" />
        ) : lead.whatsappSendStatus?.startsWith("queued") ? (
          <Pill label="Queued" active color="#B45309" />
        ) : lead.whatsappSendStatus?.startsWith("skipped") ? (
          <Pill label="Skipped" active color="#6B7280" />
        ) : lead.whatsappSendStatus ? (
          <Pill label="Failed" active color="#DC2626" />
        ) : (
          <Pill label="—" color="#6B7280" />
        )}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "180px" }}>
        {lead.emailStatus.clickedLinks?.length
          ? lead.emailStatus.clickedLinks.map((link, i) => (
              <span
                key={i}
                style={{ display: "inline-block", fontSize: "11px", color: "#2563EB", background: "#EFF4FF", padding: "2px 7px", borderRadius: "8px", margin: "1px 3px 1px 0" }}
              >
                {link}
              </span>
            ))
          : "—"}
      </td>
      <td style={{ ...tdStyle, minWidth: "180px" }}>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          placeholder="Internal note…"
          style={{ width: "100%", minHeight: "50px", fontSize: "12px", padding: "5px", border: "1px solid #E5E7EB", borderRadius: "8px", boxSizing: "border-box", resize: "vertical", color: "#374151" }}
        />
        {dirty && (
          <button type="button" style={{ ...smallBtn, marginTop: "4px" }} onClick={saveNotes} disabled={busy}>
            Save note
          </button>
        )}
      </td>
      <td style={{ ...tdStyle, minWidth: "90px" }}>
        <RowMenu
          items={[
            { label: "Send Now (Email)", onClick: sendNow, disabled: busy },
            { label: "Retry WhatsApp", onClick: retryWhatsapp, disabled: busy },
            { label: "Delete", onClick: deleteLead, tone: "danger", disabled: busy },
          ]}
        />
        {lastActionResult && (
          <div style={{ marginTop: "4px", maxWidth: "160px" }}>
            {lastActionResult.ok ? (
              <span style={{ fontSize: "10px", color: "#16A34A", whiteSpace: "normal" }}>
                {lastActionResult.intent === "sendNow" ? "Email sent" : "WhatsApp sent"}
              </span>
            ) : (
              <FriendlyErrorInline
                message={lastActionResult.intent === "sendNow" ? "Couldn't send the email" : "Couldn't send WhatsApp"}
                detail={lastActionResult.status || lastActionResult.error}
              />
            )}
          </div>
        )}
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
            <a href="/app/settings" style={{ color: "#2563EB" }}>change in Settings</a>
          </>
        ) : (
          <>
            Follow-up reminder is <s-text>off</s-text>.{" "}
            <a href="/app/settings" style={{ color: "#2563EB" }}>turn it on in Settings</a>
          </>
        )}
      </p>
      <button type="button" style={smallBtn} onClick={processQueue} disabled={busy}>
        {busy ? "Checking…" : "Process Follow-ups Now"}
      </button>
      {result && (
        result.ok ? (
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#16A34A" }}>
            {result.sent > 0
              ? `Sent ${result.sent} follow-up${result.sent === 1 ? "" : "s"}.`
              : result.note || "Nothing due right now."}
          </p>
        ) : (
          <div style={{ marginTop: "8px" }}>
            <FriendlyErrorInline message="Couldn't check for follow-ups due" detail={result.error} />
          </div>
        )
      )}
      {whatsappQueue.pending.length > 0 && (
        <div style={{ marginTop: "10px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>First sent</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {whatsappQueue.pending.map((l) => (
                <tr key={l.id}>
                  <td style={tdStyle}>{new Date(l.whatsappFirstSentAt).toLocaleString()}</td>
                  <td style={tdStyle}>{l.name || "—"}</td>
                  <td style={tdStyle}>{l.phone || "—"}</td>
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

  const { sorted: sortedLeads, sortKey, sortDir, onSort } = useSort(filteredLeads, "createdAt", "desc");

  return (
    <s-page heading={`Astro Advice — Leads (${leads.length})`} inlineSize="large">
      <WhatsAppQueueSection whatsappQueue={whatsappQueue} />
      <s-section>
        <TableGlobalStyles />
        <button
          type="button"
          onClick={() => revalidator.revalidate()}
          disabled={isRefreshing}
          style={{ ...smallBtn, fontSize: "12px", padding: "6px 14px", marginBottom: "10px" }}
        >
          {isRefreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6B7280" }}>
          Most recent {PAGE_SIZE} leads · "Opened" is best-effort (some mail clients pre-fetch/block tracking
          images) · "Clicked" is reliable and shows which link on hover · No real "delivered" signal exists · Flow's
          own run history isn't readable via API —{" "}
          <a
            href="https://admin.shopify.com/store/0f9yd0-jr/apps/flow"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2563EB" }}
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
            style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "12.5px", color: "#374151", minWidth: "220px" }}
          />
          <select
            value={calcFilter}
            onChange={(e) => setCalcFilter(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "12.5px", color: "#374151" }}
          >
            {CALC_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "12.5px", color: "#374151" }}
          >
            {EMAIL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={whatsappFilter}
            onChange={(e) => setWhatsappFilter(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "12.5px", color: "#374151" }}
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
          <span style={{ fontSize: "12px", color: "#6B7280" }}>
            Showing {filteredLeads.length} of {leads.length}
          </span>
        </div>

        {leads.length === 0 ? (
          <s-paragraph>No leads yet.</s-paragraph>
        ) : filteredLeads.length === 0 ? (
          <s-paragraph>No leads match the current filters.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <SortTh label="When" sortKey="createdAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Name" sortKey="name" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Email" sortKey="email" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th style={thStyle}>Phone</th>
                  <SortTh label="Life Stone" sortKey="lifeStoneGem" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th style={thStyle}>Calculation</th>
                  <th style={thStyle}>Shopify Sync</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>WhatsApp</th>
                  <th style={thStyle}>Clicked Links</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead) => (
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
