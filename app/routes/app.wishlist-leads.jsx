/**
 * Wishlist email + tracking viewer — mirrors app.astro-leads.jsx. Shows
 * WishlistLead rows (most recent first) with rolled-up email status
 * (sent / opened / clicked, and which specific links were clicked)
 * sourced from the same EmailEvent table, matched by trackingId, plus
 * per-lead management: lead disposition status dropdown and a "..." row-actions
 * menu (Send Now / Retry WhatsApp / Delete).
 */
import { useEffect, useState, useMemo } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { processDueWishlistEmails, resendWishlistLeadEmail, resendWishlistWhatsapp, resolveWishlistIntervalHours } from "../utils/wishlist.server";
import { getAppSettings } from "../utils/appSettings.server";

const CRON_EVERY_MS = 60 * 1000;
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

export function parseLeadStatus(rawNotes) {
  if (!rawNotes) return "New";
  const trimmed = rawNotes.trim();
  const match = trimmed.match(/^\[Status:\s*([^\]]+)\]/);
  if (match) return match[1].trim();
  const found = LEAD_STATUS_OPTIONS.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
  return found ? found.value : trimmed || "New";
}

function exportWishlistLeadsToCsv(leadsToExport) {
  if (!leadsToExport || !leadsToExport.length) {
    alert("No wishlist leads to export");
    return;
  }
  const headers = [
    "Sync Date & Time",
    "Customer Email",
    "Customer Phone",
    "Wishlist Product Titles",
    "Wishlist Product SKUs",
    "Wishlist Item Prices (INR)",
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
    const titles = lead.products.map((p) => p.title).filter(Boolean).join(" | ");
    const skus = lead.products.map((p) => p.sku || "N/A").filter(Boolean).join(" | ");
    const prices = lead.products.map((p) => (p.price ? `₹${p.price}` : "")).filter(Boolean).join(" | ");
    const leadStatus = parseLeadStatus(lead.notes);

    return [
      escapeCsv(new Date(lead.createdAt).toLocaleString()),
      escapeCsv(lead.email || ""),
      escapeCsv(lead.phone || ""),
      escapeCsv(titles || lead.productHandles.join(", ")),
      escapeCsv(skus),
      escapeCsv(prices),
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
  link.setAttribute("download", `wishlist_leads_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

  // Bulk delete
  if (intent === "bulkDelete") {
    const ids = JSON.parse(formData.get("leadIds") || "[]");
    if (!ids.length) return { intent, ok: false, error: "No leads selected" };
    try {
      const toDelete = await prisma.wishlistLead.findMany({ where: { id: { in: ids } }, select: { trackingId: true } });
      await prisma.wishlistLead.deleteMany({ where: { id: { in: ids } } });
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
  const { session, admin } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);
  const intervalMs = resolveWishlistIntervalHours(settings) * 60 * 60 * 1000;

  const leads = await prisma.wishlistLead.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_LOADER_LEADS,
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

  // Collect handles needing SKU lookup so older leads also show SKU
  const handlesNeedingSku = new Set();
  for (const l of leads) {
    const products = Array.isArray(l.products) ? l.products : [];
    for (const p of products) {
      if (p.handle && !p.sku) handlesNeedingSku.add(p.handle);
    }
  }

  const skuMap = {};
  if (handlesNeedingSku.size > 0 && admin) {
    const handlesList = [...handlesNeedingSku].slice(0, 50);
    try {
      const queryParts = handlesList.map(
        (h, i) => `p${i}: productByHandle(handle: ${JSON.stringify(h)}) { handle variants(first: 5) { nodes { sku } } }`
      );
      const res = await admin.graphql(`#graphql query WishlistSkus { ${queryParts.join(" ")} }`);
      const json = await res.json();
      handlesList.forEach((h, i) => {
        const p = json?.data?.[`p${i}`];
        if (p) {
          const skus = (p.variants?.nodes || []).map((v) => v.sku).filter(Boolean);
          if (skus.length) skuMap[h] = skus.join(", ");
        }
      });
    } catch (err) {
      console.error("[wishlist-leads] SKU lookup failed:", err);
    }
  }

  // A customer is emailed from their LATEST snapshot only, so only the newest
  // row per email can still be "waiting to send".
  const seenEmails = new Set();
  const latestPendingIds = new Set();
  for (const l of leads) {
    const key = (l.email || "").toLowerCase();
    if (seenEmails.has(key)) continue;
    seenEmails.add(key);
    if (!l.emailSendStatus) latestPendingIds.add(l.id);
  }

  return {
    serverNow: Date.now(),
    cronEveryMs: CRON_EVERY_MS,
    leads: leads.map((l) => {
      const created = l.createdAt.getTime();
      const dueAt = created + intervalMs;
      const rawProducts = Array.isArray(l.products) ? l.products : [];
      const products = rawProducts.map((p) => ({
        ...p,
        sku: p.sku || skuMap[p.handle] || null,
      }));
      return {
        schedule: latestPendingIds.has(l.id)
          ? { createdAt: created, dueAt, sendAt: Math.ceil(dueAt / CRON_EVERY_MS) * CRON_EVERY_MS }
          : null,
      ...l,
      createdAt: l.createdAt.toISOString(),
      productHandles: Array.isArray(l.productHandles) ? l.productHandles : [],
      products,
      emailStatus: eventsByTrackingId[l.trackingId] || { sent: 0, opened: 0, clicked: 0, clickedLinks: [] },
      };
    }),
  };
};

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
}

/** Ticks once a second, using the server's clock so a wrong PC clock doesn't skew the bar. */
function useServerNow(serverNow) {
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

/** Progress bar + countdown to the moment the email and WhatsApp are sent. */
function SendCountdown({ schedule, now }) {
  if (!schedule) return <span style={{ color: brand.muted }}>—</span>;
  const { createdAt, dueAt, sendAt } = schedule;
  const span = Math.max(1, sendAt - createdAt);
  const pct = Math.min(100, Math.max(0, ((now - createdAt) / span) * 100));
  const waiting = now < dueAt;
  const label = now >= sendAt
    ? "Sending now…"
    : waiting
      ? `Sends in ${formatCountdown(sendAt - now)}`
      : `Due · sending in ${formatCountdown(sendAt - now)}`;
  return (
    <div style={{ minWidth: "150px" }} title="Email and WhatsApp are sent together when this reaches zero">
      <div style={{ height: "6px", borderRadius: "999px", background: brand.border, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: brand.accent, transition: "width 1s linear" }} />
      </div>
      <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "4px", fontVariantNumeric: "tabular-nums" }}>{label}</div>
    </div>
  );
}

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

function LeadRow({ lead, selected, onToggleSelect, now }) {
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
    toast.show(`${lead.email || "Lead"} deleted`);
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
      <td style={tdStyle}>{lead.email || "—"}</td>
      <td style={tdStyle}>{lead.phone || "—"}</td>
      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "280px" }}>
        {lead.products.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {lead.products.map((p) => (
              <div
                key={p.handle}
                title={p.title + (p.sku ? ` (SKU: ${p.sku})` : "")}
                style={{ display: "flex", alignItems: "center", gap: "6px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px", padding: "4px 8px 4px 4px" }}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.title} width={28} height={28} style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: brand.divider }} />
                )}
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: "11.5px", color: brand.body, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {p.price ? <span style={{ fontSize: "11px", color: brand.accent, fontWeight: 500 }}>₹{Number(p.price).toLocaleString("en-IN")}</span> : null}
                    {p.sku ? <span style={{ fontSize: "10px", color: brand.muted, background: "#fff", padding: "0 4px", borderRadius: "4px", border: `1px solid ${brand.border}` }}>SKU: {p.sku}</span> : null}
                  </div>
                </div>
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
        <SendCountdown schedule={lead.schedule} now={now} />
      </td>
      <td style={tdStyle} title={lead.emailSendStatus || "pending — not due yet"}>
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
      <td style={tdStyle} title={lead.whatsappSendStatus || "pending — not due yet"}>
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

const EMAIL_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "pending", label: "Pending (not due yet)" },
];
const WHATSAPP_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending (not due yet)" },
];

function singleEmailMatch(lead, value) {
  if (value === "sent") return lead.emailStatus.sent > 0;
  if (value === "opened") return lead.emailStatus.opened > 0;
  if (value === "clicked") return lead.emailStatus.clicked > 0;
  if (value === "pending") return !lead.emailSendStatus;
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

export default function WishlistLeadsPage() {
  const { leads, serverNow, cronEveryMs } = useLoaderData();
  const now = useServerNow(serverNow);
  const fetcher = useFetcher();
  const toast = useToast();
  const revalidator = useRevalidator();
  const isSending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sendDueNow";
  const isRefreshing = revalidator.state === "loading";

  const [searchText, setSearchText] = useState("");
  const [emailFilter, setEmailFilter] = useState([]);
  const [whatsappFilter, setWhatsappFilter] = useState([]);
  const [leadStatusFilter, setLeadStatusFilter] = useState([]);
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, emailFilter, whatsappFilter, leadStatusFilter, uniqueOnly]);

  // Filter for unique customers (latest wishlist snapshot per customer)
  const baseLeads = useMemo(() => {
    if (!uniqueOnly) return leads;
    const seen = new Set();
    const list = [];
    for (const lead of leads) {
      const key = (lead.email || lead.phone || lead.id).toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(lead);
      }
    }
    return list;
  }, [leads, uniqueOnly]);

  const filteredLeads = baseLeads.filter((lead) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (lead.email || "").toLowerCase().includes(q) ||
      (lead.phone || "").toLowerCase().includes(q) ||
      lead.products.some((p) => (p.title || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)) ||
      lead.productHandles.some((h) => (h || "").toLowerCase().includes(q));
    return (
      matchesSearch &&
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

  const anyWaiting = leads.some((l) => l.schedule);
  useEffect(() => {
    if (!anyWaiting) return undefined;
    const id = setInterval(() => revalidator.revalidate(), 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyWaiting]);

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

  useEffect(() => {
    if (!fetcher.data || fetcher.data.intent !== "sendDueNow") return;
    if (fetcher.data.ok) {
      toast.show(`Checked ${fetcher.data.checked} customer(s), sent ${fetcher.data.sent} email(s)`);
    } else {
      toast.show("Couldn't check for due emails — try again in a moment", { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const sendDueNow = () => fetcher.submit({ intent: "sendDueNow" }, { method: "POST" });

  return (
    <PageIn>
      <PageHeader
        title={`Wishlist leads (${leads.length})`}
        description="Customers with saved wishlist items, and their reminder email status."
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => exportWishlistLeadsToCsv(filteredLeads)}
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
          </div>
        }
      />

      <button type="button" onClick={() => revalidator.revalidate()} disabled={isRefreshing} style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        {isRefreshing ? "Refreshing…" : (<><Icon name="refresh" size={13} color="currentColor" /> Refresh</>)}
      </button>
      <p style={{ margin: "0 0 8px", fontSize: "12.5px", color: brand.ink, fontVariantNumeric: "tabular-nums" }}>
        Reminders are checked every minute · next check in{" "}
        <strong>{formatCountdown(Math.ceil(now / cronEveryMs) * cronEveryMs - now)}</strong>
      </p>
      <p style={{ margin: "0 0 14px", fontSize: "12.5px", color: brand.muted }}>
        Showing 50 leads per page · emails don't send immediately — a customer gets one email once
        they've gone quiet for the interval set on the Settings page (default 2h), using their latest wishlist
        snapshot · each row's "..." menu has Send Now (email) / Retry WhatsApp / Delete.
      </p>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
        <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search email, phone, SKU, or item…" style={inputStyle} />
        <button
          type="button"
          onClick={() => setUniqueOnly((v) => !v)}
          style={{
            ...smallBtn,
            padding: "8px 14px",
            background: uniqueOnly ? brand.accentTint : "#fff",
            borderColor: uniqueOnly ? brand.accentLine : brand.border,
            color: uniqueOnly ? brand.heading : brand.body,
            fontWeight: uniqueOnly ? 600 : 500,
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          {uniqueOnly ? <Icon name="check-circle" size={13} color={brand.accent} /> : <Icon name="user" size={13} color={brand.muted} />}
          {uniqueOnly ? "Unique Customers Only (Latest)" : "Show Unique Customers Only"}
        </button>
        <MultiSelect label="lead status" options={LEAD_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} selected={leadStatusFilter} onChange={setLeadStatusFilter} />
        <MultiSelect label="email status" options={EMAIL_STATUS_OPTIONS} selected={emailFilter} onChange={setEmailFilter} />
        <MultiSelect label="WhatsApp status" options={WHATSAPP_STATUS_OPTIONS} selected={whatsappFilter} onChange={setWhatsappFilter} />
        {(searchText || emailFilter.length > 0 || whatsappFilter.length > 0 || leadStatusFilter.length > 0 || uniqueOnly) && (
          <button type="button" onClick={() => { setSearchText(""); setEmailFilter([]); setWhatsappFilter([]); setLeadStatusFilter([]); setUniqueOnly(false); }} style={smallBtn}>
            Clear filters
          </button>
        )}
        <span style={{ fontSize: "12.5px", color: brand.muted, marginLeft: "auto" }}>
          Showing {sortedLeads.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedLeads.length)} of {sortedLeads.length} {uniqueOnly ? "unique customers" : "syncs"}
        </span>
      </div>

      <BulkActionsBar count={bulk.count} onDelete={handleBulkDelete} busy={bulkBusy} noun="lead" />

      {leads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No wishlist syncs yet.</p>
      ) : filteredLeads.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No wishlist syncs match the current filters.</p>
      ) : (
        <>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
                  <SortTh label="When" sortKey="createdAt" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Email" sortKey="email" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <SortTh label="Phone" sortKey="phone" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <th style={thStyle}>Wishlist Items &amp; SKUs</th>
                  <th style={thStyle}>Lead Status</th>
                  <th style={thStyle}>Next send</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>WhatsApp</th>
                  <th style={thStyle}>Clicked Links</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} selected={bulk.isSelected(lead.id)} onToggleSelect={() => bulk.toggle(lead.id)} now={now} />
                ))}
              </tbody>
            </table>
          </div>

          {sortedLeads.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "12px 16px", background: "#fff", border: `1px solid ${brand.border}`, borderRadius: "10px" }}>
              <span style={{ fontSize: "12.5px", color: brand.muted }}>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedLeads.length)} of {sortedLeads.length} {uniqueOnly ? "unique customers" : "leads"} (Page {currentPage} of {totalPages})
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
