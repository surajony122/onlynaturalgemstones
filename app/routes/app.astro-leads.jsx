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
import {
  tableWrapStyle,
  tableStyle,
  thStyle,
  tdStyle,
  Pill,
  RowMenu,
  useSort,
  SortTh,
  useBulkSelect,
  SelectAllTh,
  BulkActionsBar,
  MultiSelect,
  brand,
  Icon,
  Card,
  PageHeader,
  PageIn,
} from "../components/table-kit";
import { useToast } from "../components/toast";
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

  // Bulk delete -- checked before the single-leadId guard below since
  // this intent works off a whole array (leadIds) instead. Added after
  // a long testing session piled up many throwaway leads that were
  // impractical to remove one at a time via each row's own "..." menu.
  if (intent === "bulkDelete") {
    const ids = JSON.parse(formData.get("leadIds") || "[]");
    if (!ids.length) return { intent, ok: false, error: "No leads selected" };
    try {
      const toDelete = await prisma.astroLead.findMany({ where: { id: { in: ids } }, select: { trackingId: true } });
      await prisma.astroLead.deleteMany({ where: { id: { in: ids } } });
      const trackingIds = toDelete.map((l) => l.trackingId).filter(Boolean);
      if (trackingIds.length) {
        await prisma.emailEvent.deleteMany({ where: { trackingId: { in: trackingIds } } });
      }
      return { intent, ok: true, deletedIds: ids, count: ids.length };
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
  fontSize: "12px",
  padding: "6px 14px",
  borderRadius: "9px",
  border: `1px solid ${brand.border}`,
  background: "#fff",
  cursor: "pointer",
  color: brand.body,
  fontWeight: 500,
};

const inputStyle = {
  padding: "9px 12px",
  borderRadius: "10px",
  border: `1px solid ${brand.border}`,
  fontSize: "12.5px",
  color: brand.ink,
  background: "#fff",
  minWidth: "220px",
};

function LeadRow({ lead, selected, onToggleSelect }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const [notes, setNotes] = useState(lead.notes || "");
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.intent === "saveNotes" && fetcher.data.ok) setDirty(false);
  }, [fetcher.data]);

  const sendNow = () => fetcher.submit({ intent: "sendNow", leadId: lead.id }, { method: "POST" });
  const retryWhatsapp = () => fetcher.submit({ intent: "resendWhatsapp", leadId: lead.id }, { method: "POST" });
  const saveNotes = () => fetcher.submit({ intent: "saveNotes", leadId: lead.id, notes }, { method: "POST" });
  const confirmDelete = () => {
    setConfirming(false);
    fetcher.submit({ intent: "delete", leadId: lead.id }, { method: "POST" });
    toast.show(`${lead.name || lead.email || "Lead"} deleted`);
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
      <td style={tdStyle}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ cursor: "pointer" }} />
      </td>
      <td style={tdStyle}>{new Date(lead.createdAt).toLocaleString()}</td>
      <td style={tdStyle}>{lead.name || "—"}</td>
      <td style={tdStyle}>{lead.email || "—"}</td>
      <td style={tdStyle}>{lead.phone || "—"}</td>
      <td style={tdStyle}>{lead.lifeStoneGem || "—"}</td>
      <td style={tdStyle}>
        {lead.calculationOk ? <Pill label="OK" active color={brand.success} /> : <Pill label="Failed" active color={brand.danger} />}
      </td>
      <td style={tdStyle} title={lead.shopifySyncStatus || ""}>
        {(lead.shopifySyncStatus || "").startsWith("OK") ? (
          <Pill label="Synced" active color={brand.success} />
        ) : lead.shopifySyncStatus ? (
          <Pill label="Failed" active color={brand.danger} />
        ) : (
          <Pill label="—" color={brand.muted} />
        )}
      </td>
      <td style={tdStyle} title={lead.emailSendStatus || ""}>
        <Pill label="Sent" active={lead.emailStatus.sent > 0} color={brand.success} />
        <Pill
          label={"Opened" + (lead.emailStatus.opened > 1 ? ` ×${lead.emailStatus.opened}` : "")}
          active={lead.emailStatus.opened > 0}
          color={brand.accent}
        />
        <Pill
          label={"Clicked" + (lead.emailStatus.clicked > 1 ? ` ×${lead.emailStatus.clicked}` : "")}
          active={lead.emailStatus.clicked > 0}
          color={brand.accent}
        />
      </td>
      <td style={tdStyle} title={lead.whatsappSendStatus || ""}>
        {lead.whatsappSendStatus?.startsWith("OK") ? (
          <Pill label="Sent" active color={brand.success} />
        ) : lead.whatsappSendStatus?.startsWith("queued") ? (
          <Pill label="Queued" active color={brand.warn} />
        ) : lead.whatsappSendStatus?.startsWith("skipped") ? (
          <Pill label="Skipped" active color={brand.muted} />
        ) : lead.whatsappSendStatus ? (
          <Pill label="Failed" active color={brand.danger} />
        ) : (
          <Pill label="—" color={brand.muted} />
        )}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "180px" }}>
        {lead.emailStatus.clickedLinks?.length
          ? lead.emailStatus.clickedLinks.map((link, i) => (
              <span
                key={i}
                style={{ display: "inline-block", fontSize: "11px", color: brand.accent, background: brand.accentTint, padding: "2px 7px", borderRadius: "8px", margin: "1px 3px 1px 0" }}
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
          style={{ width: "100%", minHeight: "50px", fontSize: "12px", padding: "6px 8px", border: `1px solid ${brand.border}`, borderRadius: "8px", boxSizing: "border-box", resize: "vertical", color: brand.body }}
        />
        {dirty && (
          <button type="button" style={{ ...smallBtn, marginTop: "4px", padding: "4px 10px", fontSize: "11px" }} onClick={saveNotes} disabled={busy}>
            Save note
          </button>
        )}
      </td>
      <td style={{ ...tdStyle, minWidth: "150px", textAlign: "right" }}>
        {confirming ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", animation: "ongFade 0.15s ease both" }}>
            <span style={{ fontSize: "12px", color: brand.danger, fontWeight: 600 }}>Delete?</span>
            <button type="button" onClick={confirmDelete} style={{ padding: "5px 11px", borderRadius: "8px", border: "none", background: brand.danger, color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} style={{ padding: "5px 11px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "12px", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <RowMenu
              items={[
                { label: "Send Now (Email)", onClick: sendNow, disabled: busy },
                { label: "Retry WhatsApp", onClick: retryWhatsapp, disabled: busy },
                { label: "Delete", onClick: () => setConfirming(true), tone: "danger", disabled: busy },
              ]}
            />
            {lastActionResult && (
              <div style={{ marginTop: "4px", maxWidth: "160px", textAlign: "left", marginLeft: "auto" }}>
                {lastActionResult.ok ? (
                  <span style={{ fontSize: "10px", color: brand.success, whiteSpace: "normal" }}>
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
          </>
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
    <Card style={{ marginBottom: "20px" }}>
      <h2 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 8px", color: brand.ink }}>WhatsApp follow-up reminders</h2>
      <p style={{ margin: "0 0 10px", fontSize: "13px", color: brand.body }}>
        First message always sends instantly on submission.{" "}
        {whatsappQueue.followUpEnabled ? (
          <>
            Follow-up reminder is <strong>on</strong> ({whatsappQueue.pending.length} lead
            {whatsappQueue.pending.length === 1 ? "" : "s"} waiting)
            {whatsappQueue.nextDue ? ` · next due ~${new Date(whatsappQueue.nextDue).toLocaleString()}` : ""}
            {" · "}
            <a href="/app/settings" style={{ color: brand.accent }}>change in Settings</a>
          </>
        ) : (
          <>
            Follow-up reminder is <strong>off</strong>.{" "}
            <a href="/app/settings" style={{ color: brand.accent }}>turn it on in Settings</a>
          </>
        )}
      </p>
      <button type="button" style={smallBtn} onClick={processQueue} disabled={busy}>
        {busy ? "Checking…" : "Process Follow-ups Now"}
      </button>
      {result &&
        (result.ok ? (
          <p style={{ margin: "8px 0 0", fontSize: "12.5px", color: brand.success }}>
            {result.sent > 0 ? `Sent ${result.sent} follow-up${result.sent === 1 ? "" : "s"}.` : result.note || "Nothing due right now."}
          </p>
        ) : (
          <div style={{ marginTop: "8px" }}>
            <FriendlyErrorInline message="Couldn't check for follow-ups due" detail={result.error} />
          </div>
        ))}
      {whatsappQueue.pending.length > 0 && (
        <div style={{ marginTop: "12px", overflowX: "auto" }}>
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
    </Card>
  );
}

// Values used both as the MultiSelect's options and as the match test
// below — kept in one place so the dropdown and the filter logic can't
// drift out of sync with each other. Same pattern as
// app.wishlist-leads.jsx. No "all"/"any" pseudo-option any more — an
// EMPTY selection now means "no filter" (MultiSelect shows "Any ..."
// itself in that case), and picking more than one value matches ANY of
// them (e.g. Failed + Skipped together) instead of exactly one.
const CALC_STATUS_OPTIONS = [
  { value: "ok", label: "OK" },
  { value: "failed", label: "Failed" },
];
const EMAIL_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "none", label: "Not sent" },
];
const WHATSAPP_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "queued", label: "Queued" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "none", label: "Not sent" },
];

function singleCalcMatch(lead, value) {
  if (value === "ok") return !!lead.calculationOk;
  if (value === "failed") return !lead.calculationOk;
  return true;
}
function matchesCalcStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleCalcMatch(lead, f));
}

function singleEmailMatch(lead, value) {
  if (value === "sent") return lead.emailStatus.sent > 0;
  if (value === "opened") return lead.emailStatus.opened > 0;
  if (value === "clicked") return lead.emailStatus.clicked > 0;
  if (value === "none") return lead.emailStatus.sent === 0;
  return true;
}
function matchesEmailStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleEmailMatch(lead, f));
}

function singleWhatsappMatch(lead, value) {
  const status = lead.whatsappSendStatus || "";
  if (value === "sent") return status.startsWith("OK");
  if (value === "queued") return status.startsWith("queued");
  if (value === "skipped") return status.startsWith("skipped");
  if (value === "failed") return !!status && !status.startsWith("OK") && !status.startsWith("queued") && !status.startsWith("skipped");
  if (value === "none") return !status;
  return true;
}
function matchesWhatsappStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleWhatsappMatch(lead, f));
}

export default function AstroLeadsPage() {
  const { leads, whatsappQueue } = useLoaderData();
  const revalidator = useRevalidator();
  const toast = useToast();
  const isRefreshing = revalidator.state === "loading";

  const [searchText, setSearchText] = useState("");
  const [calcFilter, setCalcFilter] = useState([]);
  const [emailFilter, setEmailFilter] = useState([]);
  const [whatsappFilter, setWhatsappFilter] = useState([]);

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

  const bulk = useBulkSelect(sortedLeads, "id");
  const bulkFetcher = useFetcher();
  const bulkBusy = bulkFetcher.state !== "idle";

  useEffect(() => {
    if (bulkFetcher.data?.intent === "bulkDelete" && bulkFetcher.data.ok) {
      const count = bulkFetcher.data.count;
      bulk.clear();
      revalidator.revalidate();
      toast.show(`${count} lead${count === 1 ? "" : "s"} deleted`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${bulk.count} selected lead${bulk.count === 1 ? "" : "s"}? This can't be undone.`)) return;
    bulkFetcher.submit({ intent: "bulkDelete", leadIds: JSON.stringify(bulk.selectedIds) }, { method: "POST" });
  };

  return (
    <PageIn>
      <PageHeader title={`Astro Advice leads (${leads.length})`} description="Everyone who submitted the gem recommendation form." />

      <WhatsAppQueueSection whatsappQueue={whatsappQueue} />

      <button
        type="button"
        onClick={() => revalidator.revalidate()}
        disabled={isRefreshing}
        style={{ ...smallBtn, marginBottom: "12px" }}
      >
        {isRefreshing ? "Refreshing…" : "↻ Refresh"}
      </button>
      <p style={{ margin: "0 0 14px", fontSize: "12.5px", color: brand.muted }}>
        Most recent {PAGE_SIZE} leads · "Opened" is best-effort (some mail clients pre-fetch/block tracking images)
        · "Clicked" is reliable and shows which link on hover · No real "delivered" signal exists · Flow's own run
        history isn't readable via API —{" "}
        <a href="https://admin.shopify.com/store/0f9yd0-jr/apps/flow" target="_blank" rel="noreferrer" style={{ color: brand.accent }}>
          open Shopify Flow directly
        </a>
        .
      </p>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, email, phone, or stone…" style={inputStyle} />
        <MultiSelect label="calculation status" options={CALC_STATUS_OPTIONS} selected={calcFilter} onChange={setCalcFilter} />
        <MultiSelect label="email status" options={EMAIL_STATUS_OPTIONS} selected={emailFilter} onChange={setEmailFilter} />
        <MultiSelect label="WhatsApp status" options={WHATSAPP_STATUS_OPTIONS} selected={whatsappFilter} onChange={setWhatsappFilter} />
        {(searchText || calcFilter.length > 0 || emailFilter.length > 0 || whatsappFilter.length > 0) && (
          <button type="button" onClick={() => { setSearchText(""); setCalcFilter([]); setEmailFilter([]); setWhatsappFilter([]); }} style={smallBtn}>
            Clear filters
          </button>
        )}
        <span style={{ fontSize: "12.5px", color: brand.muted, marginLeft: "auto" }}>
          Showing {filteredLeads.length} of {leads.length}
        </span>
      </div>

      <BulkActionsBar count={bulk.count} onDelete={handleBulkDelete} busy={bulkBusy} noun="lead" />

      {leads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No leads yet.</p>
      ) : filteredLeads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No leads match the current filters.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
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
                <LeadRow key={lead.id} lead={lead} selected={bulk.isSelected(lead.id)} onToggleSelect={() => bulk.toggle(lead.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
