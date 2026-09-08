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

// ---- Shared brand tokens (ONG Controls design pass, 2026-09) ---------
// Kept here since table-kit is the one file every data-list page already
// imports — other pages pull individual tokens in rather than duplicate
// the palette. Every existing key name is preserved (so nothing that
// already reads brand.accent/brand.heading/etc. breaks) — only the
// VALUES changed, to the warmer purple-accent palette from the ONG
// Controls UI redesign; new keys were added alongside for the states
// (ok/warn/danger, each with a bg/line/color triple) that design
// introduced. `accentHover`/`accentTint`/`accentLine` are fixed-hex
// approximations of that design's `color-mix()` CSS tints, since plain
// JS call sites (Pill colors, computed template strings) can't evaluate
// color-mix() themselves — GlobalStyles below defines the real
// color-mix() custom properties for anything written as inline CSS.
export const brand = {
  accent: "#5B45D6",
  accentHover: "#4934B8",
  accentTint: "#F1EEFB",
  accentLine: "#DAD1F5",
  ink: "#16141F",
  heading: "#241F33",
  body: "#4A4557",
  muted: "#7A7488",
  faint: "#A39DB2",
  success: "#0F8A5F",
  successBg: "#E9F7F1",
  successLine: "#BFE6D5",
  warn: "#9A5B08",
  warnBg: "#FDF5E7",
  warnLine: "#F2DDB4",
  danger: "#CE2247",
  dangerBg: "#FDEEF1",
  dangerLine: "#F6C9D4",
  border: "#E8E5F0",
  divider: "#F1EFF6",
  panel: "#FAF9FC",
  page: "#F6F5FA",
  shadow: "0 1px 2px rgba(22,20,31,0.05)",
  lift: "0 8px 24px -10px rgba(22,20,31,0.18)",
  mono: "'IBM Plex Mono', Menlo, Consolas, monospace",
};

// One {bg, line, color} triple per semantic state, so pages read
// `statusTone("ok")` instead of re-hardcoding the same hex three
// different ways across three different files. "read" is the one
// WhatsApp-specific extra state (a message that's been read, shown in
// the accent color rather than green/red/amber).
export function statusTone(kind) {
  switch (kind) {
    case "ok":
      return { bg: brand.successBg, line: brand.successLine, color: brand.success };
    case "warn":
      return { bg: brand.warnBg, line: brand.warnLine, color: brand.warn };
    case "danger":
      return { bg: brand.dangerBg, line: brand.dangerLine, color: brand.danger };
    case "read":
      return { bg: brand.accentTint, line: brand.accentLine, color: brand.accent };
    default:
      return { bg: brand.panel, line: brand.border, color: brand.muted };
  }
}

// Root design tokens + Google Fonts + shared keyframes/scrollbar — one
// <style> tag, rendered once from the app shell (app.jsx), not per page.
// CSS custom properties here are the "real" version of the brand.* hex
// approximations above -- anything written as inline CSS (gradients,
// box-shadows, :hover rules elsewhere in this file) can reference
// var(--accent-soft) etc. directly instead of the fixed hex.
export function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
      :root {
        --accent: ${brand.accent}; --accent-soft: color-mix(in srgb, var(--accent) 9%, #fff);
        --accent-line: color-mix(in srgb, var(--accent) 22%, #fff);
        --ink: ${brand.ink}; --heading: ${brand.heading}; --body: ${brand.body};
        --muted: ${brand.muted}; --faint: ${brand.faint};
        --border: ${brand.border}; --divider: ${brand.divider}; --panel: ${brand.panel}; --page: ${brand.page};
        --ok: ${brand.success}; --ok-bg: ${brand.successBg}; --ok-line: ${brand.successLine};
        --warn: ${brand.warn}; --warn-bg: ${brand.warnBg}; --warn-line: ${brand.warnLine};
        --danger: ${brand.danger}; --danger-bg: ${brand.dangerBg}; --danger-line: ${brand.dangerLine};
        --card: ${brand.shadow}; --lift: ${brand.lift};
      }
      body, s-page, s-section { font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important; }
      @keyframes ongIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes ongPop { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
      @keyframes ongFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes ongShimmer { from { background-position: -420px 0; } to { background-position: 420px 0; } }
      @keyframes ongSpin { to { transform: rotate(360deg); } }
      @keyframes ongPulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
      ::-webkit-scrollbar { width: 11px; height: 11px; }
      ::-webkit-scrollbar-thumb { background: #DAD6E4; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
      ::-webkit-scrollbar-thumb:hover { background: #C4BED4; background-clip: content-box; }
      .dt-row { transition: background 0.13s ease; }
      .dt-row:hover { background: var(--panel); }
      .dt-th-sort { cursor: pointer; user-select: none; }
      .dt-th-sort:hover { color: var(--body); }
    `}</style>
  );
}

// Deprecated -- the hover/sort CSS this used to render per-page now lives
// in GlobalStyles above (rendered once, from the app shell), since every
// page needs it and duplicating one <style> tag per page was pointless.
// Kept as a no-op so any page that still calls it doesn't need touching
// just for that.
export function TableGlobalStyles() {
  return null;
}

// Bordered white rounded card, the base unit almost every page's content
// is built from now — optional hover-lift (used for clickable cards like
// Overview's section grid) and a padding override for cards that need
// their own inner header band instead of uniform padding.
export function Card({ children, hover, padding = "18px 20px", style }) {
  const [hovering, setHovering] = useState(false);
  return (
    <div
      onMouseEnter={hover ? () => setHovering(true) : undefined}
      onMouseLeave={hover ? () => setHovering(false) : undefined}
      style={{
        background: "#fff",
        border: `1px solid ${brand.border}`,
        borderRadius: "14px",
        boxShadow: hover && hovering ? brand.lift : brand.shadow,
        transform: hover && hovering ? "translateY(-2px)" : "none",
        transition: "box-shadow 0.18s, transform 0.18s",
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Page-top heading block — every rewritten page opens with this instead
// of Shopify's own <s-page heading="…">, now that the app shell (sidebar
// + breadcrumb header) owns the page chrome instead of App Bridge's
// Polaris-style page wrapper.
export function PageHeader({ title, description, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "20px", flexWrap: "wrap", marginBottom: "22px" }}>
      <div>
        <h1 style={{ margin: "0 0 5px", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", color: brand.ink }}>{title}</h1>
        {description && <p style={{ margin: 0, fontSize: "14px", color: brand.muted }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

// Wraps a page's whole body in the same fade-in-and-rise entrance used
// for every tab switch in the ONG Controls design pass.
export function PageIn({ children }) {
  return <div style={{ animation: "ongIn 0.3s cubic-bezier(.22,.8,.3,1) both" }}>{children}</div>;
}

export const tableWrapStyle = {
  overflowX: "auto",
  border: `1px solid ${brand.border}`,
  borderRadius: "14px",
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
  "chevron-right": <polyline points="9 6 15 12 9 18" />,
  heart: <path d="M12 20s-8-4.9-8-10a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.1-8 10-8 10Z" />,
  tag: <><path d="M3 3h8l10 10-8 8L3 11V3Z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  alert: <><path d="M12 3 22 20 2 20Z" /><line x1="12" y1="9" x2="12" y2="14" /><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" /></>,
  x: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
  undo: <><polyline points="9 5 4 10 9 15" /><path d="M4 10h9a6 6 0 0 1 0 12h-3" /></>,
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
