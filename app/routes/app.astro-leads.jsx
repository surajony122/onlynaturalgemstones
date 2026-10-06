/**
 * Astro Advice leads + email tracking viewer. Shows the AstroLead rows
 * (most recent first) with a rolled-up email status (sent/opened/clicked,
 * and which specific links were clicked) sourced from EmailEvent rows
 * matched by trackingId, plus per-lead management: lead disposition status
 * dropdown and a "..." row-actions menu (Send Now / Retry WhatsApp / Delete).
 */
import { useEffect, useState, useMemo } from "react";
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

const PAGE_SIZE = 50;
const MAX_LOADER_LEADS = 1000;

export const LEAD_STATUS_OPTIONS = [
  { value: "New", label: "New", color: "#5f6368", bg: "#fff" },
  { value: "Bought Elsewhere", label: "Bought Elsewhere", color: "#c5221f", bg: "#fde8e8" },
  { value: "Budget Too Low", label: "Budget Too Low", color: "#b06000", bg: "#fef7e0" },
  { value: "Duplicate", label: "Duplicate", color: "#5f6368", bg: "#f1f3f4" },
  { value: "Follow Up", label: "Follow Up", color: "#1a73e8", bg: "#e8f0fe" },
  { value: "Junk", label: "Junk", color: "#c5221f", bg: "#fde8e8" },
  { value: "Maybe Later", label: "Maybe Later", color: "#b06000", bg: "#fef7e0" },
  { value: "No Response", label: "No Response", color: "#5f6368", bg: "#f1f3f4" },
  { value: "Not Interested", label: "Not Interested", color: "#c5221f", bg: "#fde8e8" },
  { value: "Qualified", label: "Qualified", color: "#1e7e34", bg: "#e6f4ea" },
];

const GEM_TO_HANDLE = {
  Ruby: "ruby",
  "Yellow Sapphire": "yellow-sapphire",
  "Blue Sapphire": "blue-sapphire",
  Emerald: "emerald",
  "Red Coral": "red-coral",
  Pearl: "pearl",
  Hessonite: "hessonite-gomed",
  "Cat's Eye": "cats-eye-lehsunia",
  Diamond: "diamond",
  "White Sapphire": "white-sapphire",
};

export function parseLeadStatus(rawNotes) {
  if (!rawNotes) return "New";
  const trimmed = rawNotes.trim();
  const match = trimmed.match(/^\[Status:\s*([^\]]+)\]/);
  if (match) return match[1].trim();
  const found = LEAD_STATUS_OPTIONS.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
  return found ? found.value : trimmed || "New";
}

function exportAstroLeadsToCsv(leadsToExport) {
  if (!leadsToExport || !leadsToExport.length) {
    alert("No astro leads to export");
    return;
  }
  const headers = [
    "Submission Date & Time",
    "Customer Name",
    "Customer Email",
    "Customer Phone",
    "Gender",
    "Date of Birth (DOB)",
    "Time of Birth (TOB)",
    "Place of Birth (POB)",
    "Body Weight (kg)",
    "Purpose",
    "Ascendant",
    "Moon Sign",
    "Sun Sign",
    "Life Stone",
    "Life Stone SKU",
    "Benefic Stone",
    "Lucky Stone",
    "Calculation Status",
    "Shopify Sync",
    "Email Status",
    "WhatsApp Status",
    "Lead Status",
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = leadsToExport.map((lead) => {
    const leadStatus = parseLeadStatus(lead.notes);

    return [
      escapeCsv(new Date(lead.createdAt).toLocaleString()),
      escapeCsv(lead.name || ""),
      escapeCsv(lead.email || ""),
      escapeCsv(lead.phone || ""),
      escapeCsv(lead.gender || ""),
      escapeCsv(lead.dob || ""),
      escapeCsv(lead.tob || ""),
      escapeCsv(lead.placeOfBirth || ""),
      escapeCsv(lead.bodyWeightKg || ""),
      escapeCsv(lead.purpose || ""),
      escapeCsv(lead.ascendant || ""),
      escapeCsv(lead.moonsign || ""),
      escapeCsv(lead.sunsign || ""),
      escapeCsv(lead.lifeStoneGem || ""),
      escapeCsv(lead.lifeStoneSku || "N/A"),
      escapeCsv(lead.beneficStoneGem || ""),
      escapeCsv(lead.luckyStoneGem || ""),
      escapeCsv(lead.calculationOk ? "OK" : "Error"),
      escapeCsv(lead.shopifySyncStatus || "N/A"),
      escapeCsv(lead.emailStatus.sent > 0 ? (lead.emailStatus.clicked > 0 ? "Clicked" : lead.emailStatus.opened > 0 ? "Opened" : "Sent") : "Pending"),
      escapeCsv(lead.whatsappSendStatus || "Pending"),
      escapeCsv(leadStatus),
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `astro_leads_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

  // Bulk delete
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
  const { session, admin } = await authenticate.admin(request);

  const leads = await prisma.astroLead.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_LOADER_LEADS,
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
    if (ev.event === "clicked" && ev.detail) {
      const label = ev.detail.includes(" -> ") ? ev.detail.split(" -> ")[0] : ev.detail;
      eventsByTrackingId[ev.trackingId].clickedLinks.push(label);
    }
  }

  // Collect unique gem names to fetch SKU for Life Stone
  const uniqueGems = [...new Set(leads.map((l) => l.lifeStoneGem).filter(Boolean))];
  const gemSkuMap = {};

  if (uniqueGems.length > 0 && admin) {
    try {
      const queryParts = uniqueGems.map((gem, i) => {
        const handle = GEM_TO_HANDLE[gem] || gem.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return `c${i}: collectionByHandle(handle: ${JSON.stringify(handle)}) { products(first: 2) { nodes { variants(first: 3) { nodes { sku } } } } }`;
      });
      const res = await admin.graphql(`#graphql query AstroGemSkus { ${queryParts.join(" ")} }`);
      const json = await res.json();
      uniqueGems.forEach((gem, i) => {
        const collection = json?.data?.[`c${i}`];
        const skus = [];
        if (collection?.products?.nodes) {
          for (const p of collection.products.nodes) {
            for (const v of p.variants?.nodes || []) {
              if (v.sku && !skus.includes(v.sku)) skus.push(v.sku);
            }
          }
        }
        if (skus.length) gemSkuMap[gem] = skus.slice(0, 3).join(", ");
      });
    } catch (err) {
      console.error("[astro-leads] SKU lookup failed:", err);
    }
  }

  return {
    whatsappQueue,
    leads: leads.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      lifeStoneSku: gemSkuMap[l.lifeStoneGem] || null,
      emailStatus: eventsByTrackingId[l.trackingId] || { sent: 0, opened: 0, clicked: 0, clickedLinks: [] },
    })),
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

function WhatsAppQueueSection({ whatsappQueue }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const isRunning = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.intent === "processQueue") {
      if (fetcher.data.ok) {
        toast.show(`Processed queue: sent ${fetcher.data.sent || 0} follow-up(s)`);
      } else {
        toast.show(fetcher.data.error || "Failed to process queue", { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const processQueue = () => fetcher.submit({ intent: "processQueue" }, { method: "POST" });

  // Follow-up reminder banner intentionally hidden on the Astro Leads page.
  if (true || !whatsappQueue || whatsappQueue.intervalMs === 0) return null;

  return (
    <Card style={{ marginBottom: "16px", background: brand.accentTint, borderColor: brand.accentLine }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: "13.5px", fontWeight: 700, color: brand.heading }}>
            WhatsApp Follow-Up Reminders ({whatsappQueue.dueCount} due now)
          </h3>
          <p style={{ margin: 0, fontSize: "12px", color: brand.body }}>
            Follow-up reminder interval: <strong>{whatsappQueue.intervalValue} {whatsappQueue.intervalUnit}</strong> after first message.
            {whatsappQueue.dueCount > 0 ? ` ${whatsappQueue.dueCount} lead(s) are waiting for follow-up.` : " All caught up."}
          </p>
        </div>
      </div>
    </Card>
  );
}

const BEST_SUITED_BY_PURPOSE = {
  General: "life",
  "Wealth & Fortune": "lucky",
  "Business & Career": "life",
  "Personal Relationships": "benefic",
  Health: "life",
  Education: "benefic",
};

function LeadRow({ lead, selected, onToggleSelect }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const currentStatus = useMemo(() => parseLeadStatus(lead.notes), [lead.notes]);
  const [statusVal, setStatusVal] = useState(currentStatus);
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    setStatusVal(parseLeadStatus(lead.notes));
  }, [lead.notes]);

  const handleStatusChange = (newStatus) => {
    setStatusVal(newStatus);
    fetcher.submit({ intent: "saveNotes", leadId: lead.id, notes: newStatus }, { method: "POST" });
    toast.show(`Status updated to "${newStatus}"`);
  };

  const sendNow = () => fetcher.submit({ intent: "sendNow", leadId: lead.id }, { method: "POST" });
  const retryWhatsapp = () => fetcher.submit({ intent: "resendWhatsapp", leadId: lead.id }, { method: "POST" });
  const confirmDelete = () => {
    setConfirming(false);
    fetcher.submit({ intent: "delete", leadId: lead.id }, { method: "POST" });
    toast.show(`${lead.name || lead.email || "Lead"} deleted`);
  };

  if (fetcher.data?.intent === "delete" && fetcher.data.ok && fetcher.data.leadId === lead.id) {
    return null;
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
      <td style={{ ...tdStyle, fontWeight: 600, color: brand.ink }}>{lead.name || "—"}</td>
      <td style={tdStyle}>{lead.email || "—"}</td>
      <td style={tdStyle}>{lead.phone || "—"}</td>
      <td style={{ ...tdStyle, minWidth: "190px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11.5px" }}>
          {lead.dob && (
            <div>
              <span style={{ color: brand.muted, fontWeight: 600 }}>DOB:</span>{" "}
              <span style={{ color: brand.ink }}>{lead.dob}</span>
            </div>
          )}
          {lead.tob && (
            <div>
              <span style={{ color: brand.muted, fontWeight: 600 }}>TOB:</span>{" "}
              <span style={{ color: brand.ink }}>{lead.tob}</span>
            </div>
          )}
          {lead.placeOfBirth && (
            <div>
              <span style={{ color: brand.muted, fontWeight: 600 }}>POB:</span>{" "}
              <span style={{ color: brand.ink }}>{lead.placeOfBirth}</span>
            </div>
          )}
          {(lead.gender || lead.bodyWeightKg) && (
            <div style={{ color: brand.muted }}>
              {lead.gender && <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{lead.gender}</span>}
              {lead.gender && lead.bodyWeightKg && " · "}
              {lead.bodyWeightKg && <span>{lead.bodyWeightKg} kg</span>}
            </div>
          )}
          {lead.purpose && (
            <div style={{ fontSize: "11px", color: "#6b5b43", background: "#faf5ee", padding: "1px 5px", borderRadius: "4px", border: `1px solid ${brand.border}`, marginTop: "2px", display: "inline-block" }}>
              Purpose: {lead.purpose}
            </div>
          )}
          {(lead.ascendant || lead.moonsign || lead.sunsign) && (
            <div style={{ fontSize: "10.5px", color: brand.muted, marginTop: "2px" }}>
              {lead.ascendant && <span>Asc: {lead.ascendant} </span>}
              {lead.moonsign && <span>Moon: {lead.moonsign} </span>}
              {lead.sunsign && <span>Sun: {lead.sunsign}</span>}
            </div>
          )}
          {!lead.dob && !lead.tob && !lead.placeOfBirth && !lead.gender && !lead.purpose && "—"}
        </div>
      </td>
      <td style={{ ...tdStyle, minWidth: "170px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {lead.lifeStoneGem && (
            <div style={{ fontSize: "12px", color: brand.ink }}>
              <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: "#c8712f", background: "#fdf1e7", padding: "1px 5px", borderRadius: "4px", marginRight: "5px" }}>Life</span>
              <span style={{ fontWeight: 600 }}>{lead.lifeStoneGem}</span>
            </div>
          )}
          {lead.beneficStoneGem && (
            <div style={{ fontSize: "12px", color: brand.ink }}>
              <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: "#5c8c5c", background: "#eef4ec", padding: "1px 5px", borderRadius: "4px", marginRight: "5px" }}>Benefic</span>
              <span style={{ fontWeight: 600 }}>{lead.beneficStoneGem}</span>
            </div>
          )}
          {lead.luckyStoneGem && (
            <div style={{ fontSize: "12px", color: brand.ink }}>
              <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", color: "#4a6fa5", background: "#eaf1f8", padding: "1px 5px", borderRadius: "4px", marginRight: "5px" }}>Lucky</span>
              <span style={{ fontWeight: 600 }}>{lead.luckyStoneGem}</span>
            </div>
          )}
          {!lead.lifeStoneGem && !lead.beneficStoneGem && !lead.luckyStoneGem && "—"}
        </div>
        {lead.lifeStoneSku ? (
          <div style={{ fontSize: "10px", color: brand.muted, background: "#fff", padding: "1px 5px", borderRadius: "4px", border: `1px solid ${brand.border}`, marginTop: "4px", display: "inline-block" }}>
            SKU: {lead.lifeStoneSku}
          </div>
        ) : null}
      </td>
      <td style={{ ...tdStyle, minWidth: "130px" }}>
        {(() => {
          // Same "Best Suited" marks as the result page's "Life, Benefic or Lucky Stone?" table.
          const kind = BEST_SUITED_BY_PURPOSE[lead.purpose] || "life";
          const gem = kind === "benefic" ? lead.beneficStoneGem : kind === "lucky" ? lead.luckyStoneGem : lead.lifeStoneGem;
          if (!gem) return "—";
          return (
            <div style={{ fontSize: "12px", color: brand.ink }}>
              <span style={{ fontWeight: 600 }}>{gem}</span>
              <div style={{ fontSize: "10px", color: brand.muted, textTransform: "capitalize" }}>{kind} stone{lead.purpose ? ` · ${lead.purpose}` : ""}</div>
            </div>
          );
        })()}
      </td>
      <td style={{ ...tdStyle, minWidth: "160px" }}>
        {(() => {
          const currentOpt = LEAD_STATUS_OPTIONS.find((o) => o.value === statusVal) || LEAD_STATUS_OPTIONS[0];
          return (
            <select
              value={statusVal}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={busy}
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "8px",
                border: `1px solid ${brand.border}`,
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: currentOpt.bg,
                color: currentOpt.color,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              {LEAD_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: "#fff", color: brand.body, fontWeight: 500 }}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        })()}
      </td>
      <td style={tdStyle}>
        {lead.calculationOk ? (
          <Pill label="OK" color={brand.success} />
        ) : (
          <Pill label="Error" active color={brand.danger} title={lead.astroError || "Calculation failed"} />
        )}
      </td>
      <td style={tdStyle}>
        {lead.shopifySyncStatus?.startsWith("OK") ? (
          <Pill label="Synced" color={brand.success} />
        ) : lead.shopifySyncStatus ? (
          <Pill label="Failed" active color={brand.danger} title={lead.shopifySyncStatus} />
        ) : (
          <Pill label="—" color={brand.muted} />
        )}
      </td>
      <td style={tdStyle} title={lead.emailSendStatus || "pending"}>
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
      <td style={tdStyle} title={lead.whatsappSendStatus || "pending"}>
        {lead.whatsappSendStatus?.startsWith("OK") ? (
          <Pill label="Sent" active color={brand.success} />
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
              <span key={i} style={{ display: "inline-block", fontSize: "11px", color: brand.accent, background: brand.accentTint, padding: "2px 7px", borderRadius: "8px", margin: "1px 3px 1px 0" }}>
                {link}
              </span>
            ))
          : "—"}
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

const CALC_STATUS_OPTIONS = [
  { value: "ok", label: "Calculation OK" },
  { value: "error", label: "Calculation Error" },
];
const EMAIL_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
];
const WHATSAPP_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

function singleCalcMatch(lead, value) {
  if (value === "ok") return lead.calculationOk;
  if (value === "error") return !lead.calculationOk;
  return true;
}
function matchesCalcStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleCalcMatch(lead, f));
}

function singleEmailMatch(lead, value) {
  if (value === "sent") return lead.emailStatus.sent > 0;
  if (value === "opened") return lead.emailStatus.opened > 0;
  if (value === "clicked") return lead.emailStatus.clicked > 0;
  return true;
}
function matchesEmailStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleEmailMatch(lead, f));
}

function singleWhatsappMatch(lead, value) {
  const status = lead.whatsappSendStatus || "";
  if (value === "sent") return status.startsWith("OK");
  if (value === "skipped") return status.startsWith("skipped");
  if (value === "failed") return !!status && !status.startsWith("OK") && !status.startsWith("skipped");
  if (value === "pending") return !status;
  return true;
}
function matchesWhatsappStatus(lead, filters) {
  return filters.length === 0 || filters.some((f) => singleWhatsappMatch(lead, f));
}

function matchesLeadStatus(lead, filters) {
  if (filters.length === 0) return true;
  const status = parseLeadStatus(lead.notes);
  return filters.includes(status);
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
  const [leadStatusFilter, setLeadStatusFilter] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, calcFilter, emailFilter, whatsappFilter, leadStatusFilter]);

  const filteredLeads = leads.filter((lead) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (lead.name || "").toLowerCase().includes(q) ||
      (lead.email || "").toLowerCase().includes(q) ||
      (lead.phone || "").toLowerCase().includes(q) ||
      (lead.lifeStoneGem || "").toLowerCase().includes(q) ||
      (lead.lifeStoneSku || "").toLowerCase().includes(q);
    return (
      matchesSearch &&
      matchesCalcStatus(lead, calcFilter) &&
      matchesEmailStatus(lead, emailFilter) &&
      matchesWhatsappStatus(lead, whatsappFilter) &&
      matchesLeadStatus(lead, leadStatusFilter)
    );
  });

  const { sorted: sortedLeads, sortKey, sortDir, onSort } = useSort(filteredLeads, "createdAt", "desc");

  const totalPages = Math.ceil(sortedLeads.length / PAGE_SIZE) || 1;
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedLeads.slice(start, start + PAGE_SIZE);
  }, [sortedLeads, currentPage]);

  const bulk = useBulkSelect(paginatedLeads, "id");
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
      <PageHeader
        title={`Astro Advice leads (${leads.length})`}
        description="Everyone who submitted the gem recommendation form."
        action={
          <button
            type="button"
            onClick={() => exportAstroLeadsToCsv(filteredLeads)}
            style={{
              padding: "9px 15px",
              borderRadius: "9px",
              border: `1px solid ${brand.border}`,
              background: "#fff",
              color: brand.body,
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Icon name="sheets" size={15} color={brand.success} /> Export to Sheet (CSV)
          </button>
        }
      />

      <WhatsAppQueueSection whatsappQueue={whatsappQueue} />

      <button
        type="button"
        onClick={() => revalidator.revalidate()}
        disabled={isRefreshing}
        style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}
      >
        {isRefreshing ? "Refreshing…" : (<><Icon name="refresh" size={13} color="currentColor" /> Refresh</>)}
      </button>
      <p style={{ margin: "0 0 14px", fontSize: "12.5px", color: brand.muted }}>
        Showing 50 leads per page · "Opened" is best-effort (some mail clients pre-fetch/block tracking images)
        · "Clicked" is reliable and shows which link on hover · No real "delivered" signal exists · Flow's own run
        history isn't readable via API —{" "}
        <a href="https://admin.shopify.com/store/0f9yd0-jr/apps/flow" target="_blank" rel="noreferrer" style={{ color: brand.accent }}>
          open Shopify Flow directly
        </a>
        .
      </p>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, email, phone, stone, or SKU…" style={inputStyle} />
        <MultiSelect label="lead status" options={LEAD_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} selected={leadStatusFilter} onChange={setLeadStatusFilter} />
        <MultiSelect label="calculation status" options={CALC_STATUS_OPTIONS} selected={calcFilter} onChange={setCalcFilter} />
        <MultiSelect label="email status" options={EMAIL_STATUS_OPTIONS} selected={emailFilter} onChange={setEmailFilter} />
        <MultiSelect label="WhatsApp status" options={WHATSAPP_STATUS_OPTIONS} selected={whatsappFilter} onChange={setWhatsappFilter} />
        {(searchText || calcFilter.length > 0 || emailFilter.length > 0 || whatsappFilter.length > 0 || leadStatusFilter.length > 0) && (
          <button type="button" onClick={() => { setSearchText(""); setCalcFilter([]); setEmailFilter([]); setWhatsappFilter([]); setLeadStatusFilter([]); }} style={smallBtn}>
            Clear filters
          </button>
        )}
        <span style={{ fontSize: "12.5px", color: brand.muted, marginLeft: "auto" }}>
          Showing {sortedLeads.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedLeads.length)} of {sortedLeads.length} leads
        </span>
      </div>

      <BulkActionsBar count={bulk.count} onDelete={handleBulkDelete} busy={bulkBusy} noun="lead" />

      {leads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No leads yet.</p>
      ) : filteredLeads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No leads match the current filters.</p>
      ) : (
        <>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
                  <SortTh label="When" sortKey="createdAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Name" sortKey="name" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Email" sortKey="email" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Birth Details</th>
                  <SortTh label="Stones & SKU" sortKey="lifeStoneGem" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th style={thStyle}>Best Suited Stone</th>
                  <th style={thStyle}>Lead Status</th>
                  <th style={thStyle}>Calculation</th>
                  <th style={thStyle}>Shopify Sync</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>WhatsApp</th>
                  <th style={thStyle}>Clicked Links</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} selected={bulk.isSelected(lead.id)} onToggleSelect={() => bulk.toggle(lead.id)} />
                ))}
              </tbody>
            </table>
          </div>

          {sortedLeads.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "12px 16px", background: "#fff", border: `1px solid ${brand.border}`, borderRadius: "10px" }}>
              <span style={{ fontSize: "12.5px", color: brand.muted }}>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedLeads.length)} of {sortedLeads.length} leads (Page {currentPage} of {totalPages})
              </span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ ...smallBtn, padding: "6px 14px", opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? "default" : "pointer" }}
                >
                  ← Previous
                </button>
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: brand.ink, padding: "0 6px" }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  style={{ ...smallBtn, padding: "6px 14px", opacity: currentPage >= totalPages ? 0.5 : 1, cursor: currentPage >= totalPages ? "default" : "pointer" }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
