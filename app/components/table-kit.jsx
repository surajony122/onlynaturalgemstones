/**
 * Shared table look-and-feel for every data-list page (Astro Leads,
 * Wishlist Leads, WhatsApp Events, Video URLs) — rounded bordered
 * container, sortable column headers, colored status pills, and a "..."
 * row-actions dropdown, all matching one consistent design instead of
 * each page hand-rolling its own table chrome. Not a route — lives
 * outside app/routes so React Router's fs-routes scan skips it.
 */
import { useEffect, useMemo, useRef, useState } from "react";

// ---- Layout tokens -------------------------------------------------

// ---- Shared brand tokens (matches the reference dashboard design) ---
// Kept here since table-kit is the one file every data-list page already
// imports — other pages pull individual tokens in rather than duplicate
// the palette.
export const brand = {
  accent: "#2563EB",
  accentHover: "#1D4ED8",
  accentTint: "#EFF4FF",
  heading: "#1E3A8A",
  body: "#374151",
  muted: "#6B7280",
  faint: "#9CA3AF",
  success: "#16A34A",
  danger: "#DC2626",
  border: "#E5E7EB",
  divider: "#EDEEF1",
  panel: "#F9FAFB",
  page: "#F3F4F6",
  shadow: "0 1px 2px rgba(16,24,40,0.05)",
};

export const tableWrapStyle = {
  overflowX: "auto",
  border: `1px solid ${brand.border}`,
  borderRadius: "12px",
  boxShadow: brand.shadow,
  width: "100%",
};

export const tableStyle = { width: "100%", borderCollapse: "collapse", background: "#fff" };

export const thStyle = {
  textAlign: "left",
  padding: "13px 14px",
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: brand.faint,
  background: brand.panel,
  borderBottom: `1px solid ${brand.border}`,
  whiteSpace: "nowrap",
};

export const tdStyle = {
  padding: "13px 14px",
  fontSize: "12.5px",
  borderBottom: `1px solid ${brand.divider}`,
  verticalAlign: "top",
  color: brand.body,
};

// One shared <style> block (hover state needs a real CSS rule, not an
// inline style, since inline styles can't express :hover) — each page
// renders this once near the top of its table section.
export function TableGlobalStyles() {
  return (
    <style>{`
      .dt-row { transition: background 0.1s ease; }
      .dt-row:hover { background: ${brand.panel}; }
      .dt-th-sort { cursor: pointer; user-select: none; }
      .dt-th-sort:hover { color: ${brand.body}; }
    `}</style>
  );
}

// ---- Sorting ---------------------------------------------------------

// Generic click-to-sort over an array of plain objects — pass whichever
// field name each column should sort by; ISO date strings sort correctly
// as plain strings, so no special-casing needed for "When"/"Sent" columns.
export function useSort(rows, initialKey = null, initialDir = "asc") {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState(initialDir);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, onSort };
}

// Sortable <th> — pass the same sortKey/sortDir/onSort a useSort() call
// returned. Non-sortable headers should just render a plain <th>.
export function SortTh({ label, sortKey, activeKey, sortDir, onSort, style }) {
  const active = activeKey === sortKey;
  return (
    <th
      className="dt-th-sort"
      onClick={() => onSort(sortKey)}
      style={{ ...thStyle, ...style }}
      title={`Sort by ${label}`}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        {label}
        <span style={{ fontSize: "10px", color: active ? brand.body : "#D1D5DB", lineHeight: 1 }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

// ---- Status pill -------------------------------------------------

// Same shape every page already used (colored-tint background + solid
// text, "inactive" state falls back to neutral gray) — centralized here
// so all four pages render pills identically.
export function Pill({ label, active, color }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        marginRight: "4px",
        marginBottom: "2px",
        borderRadius: "999px",
        fontSize: "11.5px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        background: active ? color + "22" : brand.panel,
        color: active ? color : brand.muted,
      }}
    >
      {label}
    </span>
  );
}

// ---- Row actions "..." dropdown -------------------------------------

// items: [{ label, onClick, tone?: "danger", disabled? }]. Closes on
// outside click. Renders nothing (well, a bare dash) if every item was
// filtered out by the caller — keeps the column from looking broken.
export function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const visible = (items || []).filter(Boolean);
  if (!visible.length) return <span style={{ color: "#D1D5DB" }}>—</span>;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Row actions"
        style={{
          border: "1px solid transparent",
          background: open ? brand.panel : "transparent",
          cursor: "pointer",
          fontSize: "18px",
          color: brand.muted,
          padding: "3px 9px",
          borderRadius: "8px",
          lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: "4px",
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${brand.border}`,
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(16,24,40,0.12)",
            minWidth: "170px",
            overflow: "hidden",
          }}
        >
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "9px 12px",
                fontSize: "12.5px",
                fontWeight: 500,
                border: "none",
                borderBottom: i < visible.length - 1 ? `1px solid ${brand.divider}` : "none",
                background: "transparent",
                cursor: item.disabled ? "default" : "pointer",
                color: item.tone === "danger" ? "#DC2626" : brand.body,
                opacity: item.disabled ? 0.5 : 1,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
