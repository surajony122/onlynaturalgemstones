/**
 * Contact Leads: messages sent through the storefront "Contact us" form.
 * Staff can search, set a status, reply by email, export to CSV or delete (one row, or several at once).
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { LEAD_STATUS_OPTIONS } from "../utils/leadStatuses";
import { brand, Icon, Card, PageHeader, PageIn, MultiSelect, RowMenu, useBulkSelect, SelectAllTh, BulkBar, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const rows = await prisma.contactLead.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = String(form.get("id") || "");
  try {
    if (intent === "status") {
      const status = String(form.get("status") || "");
      if (!LEAD_STATUS_OPTIONS.some((o) => o.value === status)) return { intent, ok: false, error: "Unknown status" };
      await prisma.contactLead.update({ where: { id }, data: { status } });
      return { intent, ok: true };
    }
    if (intent === "delete") {
      await prisma.contactLead.delete({ where: { id } });
      return { intent, ok: true };
    }
    if (intent === "bulkDelete") {
      const ids = JSON.parse(String(form.get("ids") || "[]"));
      if (!ids.length) return { intent, ok: false, error: "No leads selected" };
      await prisma.contactLead.deleteMany({ where: { id: { in: ids } } });
      return { intent, ok: true, count: ids.length };
    }
    if (intent === "bulkStatus") {
      const ids = JSON.parse(String(form.get("ids") || "[]"));
      const status = String(form.get("status") || "");
      if (!LEAD_STATUS_OPTIONS.some((o) => o.value === status)) return { intent, ok: false, error: "Unknown status" };
      if (!ids.length) return { intent, ok: false, error: "No leads selected" };
      await prisma.contactLead.updateMany({ where: { id: { in: ids } }, data: { status } });
      return { intent, ok: true, count: ids.length, status };
    }
  } catch (err) {
    return { intent, ok: false, error: String((err && err.message) || err) };
  }
  return { intent, ok: false, error: "Unknown action" };
};


const btn = { display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none" };

function exportCsv(rows) {
  if (!rows.length) return alert("No contact leads to export");
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Name", "Email", "Phone", "Message", "Status"].join(",")].concat(
    rows.map((r) => [new Date(r.createdAt).toLocaleString(), r.name, r.email, r.phone, r.message, r.status].map(q).join(","))
  );
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `contact_leads_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Row({ r, selected, onToggleSelect }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const res = fetcher.state === "idle" ? fetcher.data : null;
  useEffect(() => {
    if (res && !res.ok) toast.show(res.error || "Could not save", { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const status = fetcher.formData?.get("status") || r.status;
  const known = LEAD_STATUS_OPTIONS.find((o) => o.value === status);
  const tone = known || { color: brand.body, bg: "#fff" }; // an older status that is no longer in the list still shows as it was
  return (
    <tr className="dt-row" style={{ opacity: fetcher.formData?.get("intent") === "delete" ? 0.4 : 1 }}>
      <td style={tdStyle}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ cursor: "pointer" }} />
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "12px", color: brand.muted }}>{new Date(r.createdAt).toLocaleString()}</td>
      <td style={tdStyle}>
        <div style={{ fontWeight: 600, color: brand.ink }}>{r.name || "No name"}</div>
        <div style={{ fontSize: "11.5px", color: brand.muted }}>{r.email}</div>
        {r.phone && <div style={{ fontSize: "11.5px", color: brand.muted }}>{r.phone}</div>}
      </td>
      <td style={{ ...tdStyle, maxWidth: "380px", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{r.message || <span style={{ color: brand.faint }}>No message</span>}</td>
      <td style={tdStyle}>
        <select
          value={status}
          disabled={busy}
          onChange={(e) => fetcher.submit({ intent: "status", id: r.id, status: e.target.value }, { method: "post" })}
          style={{ padding: "5px 8px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: tone.bg, color: tone.color, fontWeight: 600, fontSize: "12px", fontFamily: "inherit" }}
        >
          {!known && <option value={status}>{status}</option>}
          {LEAD_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td style={{ ...tdStyle, minWidth: "90px", textAlign: "right" }}>
        <RowMenu
          items={[
            r.email ? { label: "Reply by email", onClick: () => { window.location.href = `mailto:${r.email}?subject=${encodeURIComponent("Re: your message to Only Natural Gemstones")}`; } } : null,
            { label: "Delete", tone: "danger", disabled: busy, onClick: () => window.confirm("Delete this contact lead?") && fetcher.submit({ intent: "delete", id: r.id }, { method: "post" }) },
          ]}
        />
      </td>
    </tr>
  );
}

export default function ContactLeadsPage() {
  const { rows } = useLoaderData();
  const [statusFilter, setStatusFilter] = useState([]);
  const [search, setSearch] = useState("");
  const bulkFetcher = useFetcher();
  const toast = useToast();
  const [bulkStatus, setBulkStatus] = useState("");
  const counts = useMemo(() => {
    const c = { all: rows.length };
    rows.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
    return c;
  }, [rows]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (statusFilter.length === 0 || statusFilter.includes(r.status)) && (!q || [r.name, r.email, r.phone, r.message].join(" ").toLowerCase().includes(q)));
  }, [rows, statusFilter, search]);

  const bulk = useBulkSelect(shown, "id");
  const bulkBusy = bulkFetcher.state !== "idle";
  useEffect(() => {
    const d = bulkFetcher.data;
    if (!d || (d.intent !== "bulkDelete" && d.intent !== "bulkStatus")) return;
    if (d.ok) {
      toast.show(d.intent === "bulkDelete" ? `${d.count} lead${d.count === 1 ? "" : "s"} deleted` : `${d.count} lead${d.count === 1 ? "" : "s"} set to "${d.status}"`);
      bulk.clear();
      setBulkStatus("");
    } else {
      toast.show(d.error || "Could not save", { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);
  const selectedRows = shown.filter((r) => bulk.selectedIds.includes(r.id));
  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${bulk.count} selected lead${bulk.count === 1 ? "" : "s"}? This can't be undone.`)) return;
    bulkFetcher.submit({ intent: "bulkDelete", ids: JSON.stringify(bulk.selectedIds) }, { method: "post" });
  };
  const handleBulkStatus = () => {
    if (!bulkStatus) return;
    bulkFetcher.submit({ intent: "bulkStatus", ids: JSON.stringify(bulk.selectedIds), status: bulkStatus }, { method: "post" });
  };

  return (
    <PageIn>
      <PageHeader
        title="Contact Leads"
        description="Messages sent through the Contact us form on your website."
        stats={[
          { label: "Total", value: counts.all || 0 },
          { label: "New", value: counts.New || 0, tone: (counts.New || 0) > 0 ? "accent" : undefined },
          { label: "Qualified", value: counts.Qualified || 0, tone: "success" },
          { label: "Follow Up", value: counts["Follow Up"] || 0 },
        ]}
        actions={
          <button type="button" onClick={() => exportCsv(shown)} style={{ ...btn, padding: "8px 14px", fontSize: "13px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body }}>
            <Icon name="download" size={14} color="currentColor" />
            Export CSV
          </button>
        }
      />
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <MultiSelect label="lead status" options={LEAD_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} selected={statusFilter} onChange={setStatusFilter} />
        {statusFilter.length > 0 && (
          <button type="button" onClick={() => setStatusFilter([])} style={{ ...btn, border: `1px solid ${brand.border}`, background: "#fff", color: brand.body }}>
            Clear filter
          </button>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or message…"
          style={{ marginLeft: "auto", minWidth: "240px", padding: "8px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px", fontFamily: "inherit" }}
        />
      </div>
      <BulkBar count={bulk.count} noun="lead">
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value)}
          disabled={bulkBusy}
          style={{ padding: "5px 8px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: "#fff", fontSize: "12px", fontFamily: "inherit" }}
        >
          <option value="">Set status…</option>
          {LEAD_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="button" onClick={handleBulkStatus} disabled={bulkBusy || !bulkStatus} style={{ ...btn, border: `1px solid ${brand.accent}`, background: brand.accent, color: "#fff", opacity: bulkBusy || !bulkStatus ? 0.5 : 1 }}>
          Apply
        </button>
        <button type="button" onClick={() => exportCsv(selectedRows)} style={{ ...btn, border: `1px solid ${brand.border}`, background: "#fff", color: brand.body }}>
          <Icon name="download" size={12} color="currentColor" />
          Export selected
        </button>
        <button type="button" onClick={handleBulkDelete} disabled={bulkBusy} style={{ ...btn, border: "none", background: brand.danger, color: "#fff", opacity: bulkBusy ? 0.6 : 1 }}>
          {bulkBusy ? "Working…" : `Delete selected (${bulk.count})`}
        </button>
      </BulkBar>
      {shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: "13px", color: brand.muted }}>
            {rows.length === 0 ? "No messages yet. They appear here as soon as someone sends the Contact us form." : "No messages match this filter."}
          </p>
        </Card>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <SelectAllTh checked={bulk.allSelected} indeterminate={bulk.count > 0 && !bulk.allSelected} onChange={bulk.toggleAll} />
                <th style={thStyle}>Received</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Message</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.id} r={r} selected={bulk.isSelected(r.id)} onToggleSelect={() => bulk.toggle(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageIn>
  );
}
