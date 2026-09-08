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

// ---- Bulk selection ---------------------------------------------------

// Checkbox-select-and-bulk-delete, shared across every leads-style page
// (Astro Leads, Wishlist Leads, WhatsApp Events' message log) -- added
// after real test data piled up across a long session and deleting one
// row at a time via each row's "..." menu became impractical. `rows` is
// whatever's currently visible (already search/filter/sorted) so
// "select all" only selects what's on screen, not the full unfiltered
// table -- selecting after narrowing down a search is the common case
// this exists for.
export function useBulkSelect(rows, idKey = "id") {
  const [selected, setSelected] = useState(() => new Set());
  const visibleIds = rows.map((r) => r[idKey]);
  const visibleIdSet = new Set(visibleIds);
  // Only count/act on selections that are still actually visible --
  // narrowing a filter after selecting shouldn't silently carry hidden
  // rows into a later "delete selected" click.
  const activeSelected = [...selected].filter((id) => visibleIdSet.has(id));
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };
  const clear = () => setSelected(new Set());
  const isSelected = (id) => selected.has(id);

  return { selectedIds: activeSelected, count: activeSelected.length, allSelected, toggle, toggleAll, clear, isSelected };
}

/** Header checkbox column cell -- a native checkbox has no built-in
 * "some but not all" visual, so this sets the DOM indeterminate flag
 * imperatively via a ref (the one thing a plain `checked` prop can't
 * express) whenever some, but not all, visible rows are selected. */
export function SelectAllTh({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <th style={{ ...thStyle, width: "36px" }}>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} style={{ cursor: "pointer" }} />
    </th>
  );
}

/** One bulk-actions bar, shown only once something's selected --
 * appears above the table, matching the same "nothing to see until
 * it's relevant" pattern as this app's other conditional UI (Explain
 * toggles, etc.). `busy` disables the button mid-delete so a slow
 * request can't be double-submitted by an extra click. */
export function BulkActionsBar({ count, onDelete, busy, noun = "lead" }) {
  if (count === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 14px",
        background: brand.accentTint,
        border: `1px solid ${brand.accent}`,
        borderRadius: "10px",
        marginBottom: "12px",
      }}
    >
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: brand.heading }}>
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "#fff",
          background: brand.danger,
          border: "none",
          borderRadius: "8px",
          padding: "6px 14px",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Deleting…" : `Delete Selected (${count})`}
      </button>
    </div>
  );
}

// ---- Icons -----------------------------------------------------------

// Stroke-based line icons, one consistent style, replacing the emoji
// this app used to use for section/nav icons (👥💬📦⚙️🩺✉️💎 etc.) —
// emoji render inconsistently across platforms/fonts and don't take a
// deliberate brand color the way a stroke icon does. Same shapes used
// in the ONG Controls UI design pass, kept here (not duplicated per
// page) since every page that needs an icon already imports table-kit.
const ICON_PATHS = {
  diamond: <><path d="M6 3h12l4 6-10 12L2 9Z" /><path d="M2 9h20M9 3l3 6-3 12M15 3l-3 6 3 12" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.3" /><path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8" /></>,
  message: <path d="M4 5h16v11H8l-4 4V5z" />,
  package: <><path d="M3 8 12 4 21 8 12 12 3 8Z" /><path d="M3 8v9l9 4 9-4V8" /><line x1="12" y1="12" x2="12" y2="21" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4.6a7.6 7.6 0 0 0-1.7-1L14.8 3h-3.9l-.5 2.7a7.6 7.6 0 0 0-1.7 1l-2.4-.6-2 3.4L6.3 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-.6a7.6 7.6 0 0 0 1.7 1l.5 2.7h3.9l.5-2.7a7.6 7.6 0 0 0 1.7-1l2.4.6 2-3.4-2-1.5Z" /></>,
  activity: <polyline points="2 12 7 12 9 6 14 18 16 12 22 12" />,
  mail: <><path d="M3 5h18v14H3V5Z" /><path d="M3 6l9 7 9-7" /></>,
  phone: <path d="M6.6 10.8a15.7 15.7 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 9.7 9.7 0 0 0 3 .5 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 9.7 9.7 0 0 0 .5 3 1 1 0 0 1-.25 1Z" />,
  cart: <><circle cx="9" cy="21" r="1.4" /><circle cx="18" cy="21" r="1.4" /><path d="M1 2h3l2.5 12.5a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 6H5.2" /></>,
  sheet: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" /></>,
  pin: <><path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.3" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="1.2" /><rect x="3" y="14" width="18" height="6" rx="1.2" /><line x1="7" y1="7" x2="7.01" y2="7" /><line x1="7" y1="17" x2="7.01" y2="17" /></>,
  database: <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  refresh: <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.5 9a8.5 8.5 0 0 1 14-3.3L23 10M1 14l5.5 4.3A8.5 8.5 0 0 0 20.5 15" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-4.13 5.44M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>,
  "chevron-down": <polyline points="6 9 12 15 18 9" />,
  "chevron-up": <polyline points="6 15 12 9 18 15" />,
  "check-circle": <><circle cx="12" cy="12" r="9" /><polyline points="8 12 11 15 16 9" /></>,
  "x-circle": <><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></>,
  package_box: <path d="M3 8 12 4 21 8 12 12 3 8Z" />,
};

/** A single stroke icon from the shared set above. `name` picks the
 * shape, `size` (px) and `color` (any CSS color, defaults to
 * currentColor so it inherits the surrounding text color like an emoji
 * used to) are the only things most call sites need. */
export function Icon({ name, size = 16, color = "currentColor", style, ...rest }) {
  const body = ICON_PATHS[name];
  if (!body) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      {...rest}
    >
      {body}
    </svg>
  );
}
