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
  // Site's own gold/bronze, not a generic purple/blue -- matches the
  // storefront's real brand accent (see the "ONG Standard" section),
  // confirmed already used elsewhere in this project's cart-page work.
  accent: "#C8944A",
  accentHover: "#A97A38",
  accentTint: "#FBF3E5",
  accentLine: "#EDD9B8",
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
      /* Explicit request: no bold anywhere in this app's UI -- every
         inline fontWeight (500/600/700) this redesign set gets flattened
         back to regular weight here rather than hand-editing each one. */
      body, body * { font-weight: 400 !important; }
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

// ---- Multi-select filter dropdown -------------------------------------

// Replaces a plain single-value <select> filter with a checkbox-list
// popover, so e.g. "Failed" and "Skipped" can both be checked at once
// instead of picking exactly one status. `selected` is an array of
// values; an EMPTY array means "no filter" (matches everything), same
// meaning "All"/"Any status" had as the native <select>'s default
// option -- callers' match functions just check
// `selected.length === 0 || selected.includes(x)`.
export function MultiSelect({ label, options, selected, onChange }) {
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

  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary =
    selected.length === 0
      ? `Any ${label}`
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || `1 selected`
      : `${selected.length} ${label} selected`;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "7px",
          padding: "9px 12px",
          borderRadius: "10px",
          border: `1px solid ${selected.length ? brand.accentLine : brand.border}`,
          background: selected.length ? brand.accentTint : "#fff",
          fontSize: "12.5px",
          color: selected.length ? brand.accent : brand.ink,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {summary}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={12} color="currentColor" />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "100%",
            marginTop: "4px",
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${brand.border}`,
            borderRadius: "10px",
            boxShadow: "0 8px 24px -8px rgba(22,20,31,0.25)",
            minWidth: "200px",
            maxHeight: "280px",
            overflowY: "auto",
            padding: "6px",
          }}
        >
          {options.map((o) => (
            <label
              key={o.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                padding: "7px 8px",
                borderRadius: "8px",
                fontSize: "12.5px",
                color: brand.body,
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} style={{ cursor: "pointer" }} />
              {o.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: "4px", padding: "7px 8px", borderRadius: "8px", border: "none", background: "transparent", fontSize: "12px", color: brand.muted, cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
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
        <Icon name={active ? (sortDir === "asc" ? "chevron-up" : "chevron-down") : "sort"} size={12} color={active ? brand.body : "#D1D5DB"} />
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

// Stroke-based line icons, one consistent style, replacing every emoji
// this app used to use for section/nav icons/status labels -- emoji
// render inconsistently across platforms/fonts and don't take a
// deliberate brand color the way a stroke icon does. Sourced from the
// "ONG Icon Library" sprite (per explicit request), kept here (not
// duplicated per page) since every page that needs an icon already
// imports table-kit. "chevron-up" isn't in that library -- kept as a
// small hand-drawn addition since several accordion toggles rely on it.
const ICON_PATHS = {
  activity: <polyline points="2 12 7 12 9 6 14 18 16 12 22 12" />,
  "alert-circle": <><circle cx="12" cy="12" r="9" /><line x1="12" y1="7.5" x2="12" y2="13" /><circle cx="12" cy="16.3" r="0.7" fill="currentColor" stroke="none" /></>,
  "alert-octagon": <><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3Z" /><line x1="12" y1="7.5" x2="12" y2="13" /><circle cx="12" cy="16.3" r="0.7" fill="currentColor" stroke="none" /></>,
  "alert-square": <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><line x1="12" y1="7.5" x2="12" y2="13" /><circle cx="12" cy="16.3" r="0.7" fill="currentColor" stroke="none" /></>,
  "alert-triangle": <><path d="M12 3 22 20 2 20Z" /><line x1="12" y1="9" x2="12" y2="14" /><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" /></>,
  archive: <><rect x="3" y="4" width="18" height="4.5" rx="1.4" /><path d="M4.5 8.5h15V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V8.5Z" /><line x1="10" y1="13" x2="14" y2="13" /></>,
  "arrow-left": <><line x1="20" y1="12" x2="5" y2="12" /><polyline points="11 6 5 12 11 18" /></>,
  "arrow-right": <><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></>,
  "at-sign": <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 5 2 9 9 0 1 0-3.5 4.5" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /></>,
  banknote: <><rect x="2.5" y="6.5" width="19" height="11" rx="2" /><circle cx="12" cy="12" r="2.6" /><line x1="6" y1="12" x2="6.01" y2="12" /><line x1="18" y1="12" x2="18.01" y2="12" /></>,
  "bar-chart": <><line x1="3" y1="20" x2="21" y2="20" /><rect x="5" y="11" width="3.5" height="9" /><rect x="10.5" y="6" width="3.5" height="14" /><rect x="16" y="14" width="3.5" height="6" /></>,
  bell: <><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></>,
  "bell-off": <><path d="M8.2 6.3A6 6 0 0 1 18 10c0 4 1.5 5.5 1.5 5.5H8" /><path d="M6.1 9.2C6 9.5 6 9.7 6 10c0 4-1.5 5.5-1.5 5.5h2" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  "bell-ring": <><path d="M7 11a5 5 0 0 1 10 0c0 3.6 1.4 5 1.4 5H5.6S7 14.6 7 11Z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /><path d="M3.5 8.5A5.5 5.5 0 0 1 5.8 4" /><path d="M20.5 8.5A5.5 5.5 0 0 0 18.2 4" /></>,
  bookmark: <path d="M6 3h12v18l-6-4.5L6 21V3Z" />,
  "box-open": <><path d="M3 9.5 6 4h12l3 5.5" /><path d="M3 9.5h18V20H3V9.5Z" /><line x1="12" y1="4" x2="12" y2="9.5" /><line x1="9" y1="13" x2="15" y2="13" /></>,
  bug: <><rect x="8" y="8" width="8" height="11" rx="4" /><path d="M9.5 8 8 5.5M14.5 8 16 5.5" /><line x1="4.5" y1="11" x2="8" y2="12" /><line x1="19.5" y1="11" x2="16" y2="12" /><line x1="4.5" y1="17" x2="8" y2="16" /><line x1="19.5" y1="17" x2="16" y2="16" /><line x1="5.5" y1="14" x2="8" y2="14" /><line x1="18.5" y1="14" x2="16" y2="14" /></>,
  calculator: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><rect x="7" y="6" width="10" height="3.5" rx="1" /><line x1="8" y1="13" x2="8.01" y2="13" /><line x1="12" y1="13" x2="12.01" y2="13" /><line x1="16" y1="13" x2="16.01" y2="13" /><line x1="8" y1="17" x2="8.01" y2="17" /><line x1="12" y1="17" x2="12.01" y2="17" /><line x1="16" y1="17" x2="16.01" y2="17" /></>,
  calendar: <><rect x="3" y="5.5" width="18" height="15" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /></>,
  cart: <><path d="M2.5 4h2.2l2.6 10.5h10.4L21 7H6" /><circle cx="9" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" /></>,
  check: <polyline points="4 12 10 18 20 6" />,
  "check-circle": <><circle cx="12" cy="12" r="9" /><polyline points="8 12 11 15 16 9" /></>,
  "chevron-down": <polyline points="5 9 12 16 19 9" />,
  "chevron-up": <polyline points="6 15 12 9 18 15" />,
  "chevron-right": <polyline points="9 5 16 12 9 19" />,
  clipboard: <><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 4.5V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4.5" /><line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="13" y2="15" /></>,
  "clipboard-check": <><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 4.5V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4.5" /><polyline points="8.5 13 11 15.5 15.5 10.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></>,
  cloud: <path d="M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 10.5a3.8 3.8 0 0 1 0 7.5H7Z" />,
  "cloud-off": <><path d="M9.5 18H7a4 4 0 0 1-.4-8" /><path d="M9 6.3A5.5 5.5 0 0 1 17 10.5a3.8 3.8 0 0 1 1.5 7.1" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M15 11.4c3.2.3 6 1.5 6 3.1v3c0 1.7-2.7 3-6 3s-6-1.3-6-3v-3" /></>,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 6V4.5A1.5 1.5 0 0 0 13.5 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H6" /></>,
  "credit-card": <><rect x="2.5" y="5" width="19" height="14" rx="2.2" /><line x1="2.5" y1="10" x2="21.5" y2="10" /><line x1="6" y1="15" x2="10" y2="15" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  diamond: <><path d="M6 3h12l4 6-10 12L2 9Z" /><path d="M2 9h20M9 3l3 6-3 12M15 3l-3 6 3 12" /></>,
  download: <><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 10 12 15 17 10" /><path d="M4 19h16" /></>,
  drag: <><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" /></>,
  edit: <><path d="M4 20h4L20 8l-4-4L4 16v4Z" /><line x1="14.5" y1="5.5" x2="18.5" y2="9.5" /></>,
  "external-link": <><path d="M13 4h7v7" /><line x1="20" y1="4" x2="11" y2="13" /><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" /></>,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-4.13 5.44M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>,
  facebook: <><rect x="3" y="3" width="18" height="18" rx="4.5" /><path d="M15.5 8h-1.8A2.2 2.2 0 0 0 11.5 10.2V21" /><line x1="9" y1="13" x2="14.5" y2="13" /></>,
  "file-export": <><path d="M13 21H6V3h8l5 5v4" /><path d="M14 3v5h5" /><line x1="12" y1="17" x2="21" y2="17" /><polyline points="18 14 21 17 18 20" /></>,
  "file-plus": <><path d="M6 3h8l5 5v13H6V3Z" /><path d="M14 3v5h5" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" /></>,
  "file-text": <><path d="M6 3h8l5 5v13H6V3Z" /><path d="M14 3v5h5" /><line x1="9" y1="13" x2="16" y2="13" /><line x1="9" y1="17" x2="14" y2="17" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />,
  flag: <><line x1="5.5" y1="3" x2="5.5" y2="21" /><path d="M5.5 4h11l-1.8 4L16.5 12h-11V4Z" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4L11 8h8.5A1.5 1.5 0 0 1 21 9.5v9A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-12Z" />,
  frown: <><circle cx="12" cy="12" r="9" /><path d="M8.5 15.5a4.4 4.4 0 0 1 7 0" /><circle cx="9.3" cy="9.8" r="0.8" fill="currentColor" stroke="none" /><circle cx="14.7" cy="9.8" r="0.8" fill="currentColor" stroke="none" /></>,
  gauge: <><path d="M3.5 18a9 9 0 1 1 17 0" /><line x1="12" y1="18" x2="16" y2="11" /><circle cx="12" cy="18" r="1.3" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4.6a7.6 7.6 0 0 0-1.7-1L14.8 3h-3.9l-.5 2.7a7.6 7.6 0 0 0-1.7 1l-2.4-.6-2 3.4L6.3 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-.6a7.6 7.6 0 0 0 1.7 1l.5 2.7h3.9l.5-2.7a7.6 7.6 0 0 0 1.7-1l2.4.6 2-3.4-2-1.5Z" /></>,
  gem: <><path d="M12 3 20 10l-8 11L4 10 12 3Z" /><path d="M8 7.5 12 12l4-4.5M4 10h16" /></>,
  gift: <><rect x="3" y="9" width="18" height="11" rx="1.6" /><line x1="3" y1="13" x2="21" y2="13" /><line x1="12" y1="9" x2="12" y2="20" /><path d="M12 9C10.5 5.5 6 5 6 7.5S9.5 9 12 9s6 .5 6-1.5S13.5 5.5 12 9Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3c2.6 2.4 4 5.4 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.4-4-9s1.4-6.6 4-9Z" /></>,
  google: <><path d="M20.5 12.2a8.5 8.5 0 1 1-2.6-6.1" /><path d="M12 12h8.5c0 4.7-3.4 8.5-8.5 8.5" /><line x1="12" y1="12" x2="20.5" y2="12" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  heart: <path d="M12 20s-8-4.9-8-10a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.1-8 10-8 10Z" />,
  "heart-off": <><path d="M8.5 6.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3c0 2.6-2 5.1-4.2 7" /><path d="M4.6 8.6A4.6 4.6 0 0 0 4 10c0 5.1 8 10 8 10a30 30 0 0 0 2.4-1.6" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  "help-circle": <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7v.3" /><circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><polyline points="3 4 3 9 8 9" /><polyline points="12 8 12 12 15.5 14" /></>,
  home: <><path d="M4 10.5 12 4l8 6.5V20H4v-9.5Z" /><path d="M9.5 20v-6h5v6" /></>,
  hourglass: <><path d="M6 3h12M6 21h12" /><path d="M7 3c0 4 5 5 5 9s-5 5-5 9" /><path d="M17 3c0 4-5 5-5 9s5 5 5 9" /></>,
  "id-card": <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><circle cx="8.5" cy="11" r="2" /><path d="M5 16.5c0-1.7 1.6-2.8 3.5-2.8s3.5 1.1 3.5 2.8" /><line x1="15" y1="10.5" x2="19" y2="10.5" /><line x1="15" y1="14" x2="19" y2="14" /></>,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M3.5 17 9 12l4 3.5 3-2.5 4.5 4" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 4.5h13L21 13v5.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V13l2.5-8.5Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1.05" fill="currentColor" stroke="none" /></>,
  key: <><circle cx="8" cy="8" r="4.5" /><line x1="11.2" y1="11.2" x2="20" y2="20" /><line x1="17" y1="20" x2="20" y2="17" /></>,
  layers: <><path d="M12 3 21 8l-9 5-9-5 9-5Z" /><path d="M3 13l9 5 9-5" /></>,
  link: <><path d="M10 13.5 13.5 10" /><path d="M8.5 15.5 7 17a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" /><path d="M15.5 8.5 17 7a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" /></>,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><line x1="7.5" y1="10.5" x2="7.5" y2="17" /><circle cx="7.5" cy="7.4" r="1.05" fill="currentColor" stroke="none" /><path d="M11.5 17v-6" /><path d="M11.5 13.2a2.2 2.2 0 0 1 4.4 0V17" /></>,
  list: <><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  loader: <><line x1="12" y1="3" x2="12" y2="6.5" /><line x1="12" y1="17.5" x2="12" y2="21" /><line x1="3" y1="12" x2="6.5" y2="12" /><line x1="17.5" y1="12" x2="21" y2="12" /><line x1="5.6" y1="5.6" x2="8.1" y2="8.1" /><line x1="15.9" y1="15.9" x2="18.4" y2="18.4" /><line x1="5.6" y1="18.4" x2="8.1" y2="15.9" /><line x1="15.9" y1="8.1" x2="18.4" y2="5.6" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></>,
  "log-out": <><path d="M14 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h8" /><polyline points="16 8 20 12 16 16" /><line x1="9.5" y1="12" x2="20" y2="12" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5 12 13l8.5-6.5" /></>,
  "mail-open": <><path d="M3 10.5 12 4l9 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-8.5Z" /><path d="M3.5 11 12 17l8.5-6" /></>,
  "map-pin": <><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  maximize: <><polyline points="4 9 4 4 9 4" /><polyline points="15 4 20 4 20 9" /><polyline points="20 15 20 20 15 20" /><polyline points="9 20 4 20 4 15" /></>,
  menu: <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>,
  message: <path d="M4 5h16v11H8l-4 4V5Z" />,
  "message-dots": <><path d="M4 5h16v11H8l-4 4V5Z" /><circle cx="9" cy="10.5" r="1" /><circle cx="12" cy="10.5" r="1" /><circle cx="15" cy="10.5" r="1" /></>,
  messages: <><path d="M3 4h13v9H7l-4 3.5V4Z" /><path d="M8 16v1.5h8l4 3V9.5h-4" /></>,
  minimize: <><polyline points="9 4 9 9 4 9" /><polyline points="20 9 15 9 15 4" /><polyline points="15 20 15 15 20 15" /><polyline points="4 15 9 15 9 20" /></>,
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  "more-horizontal": <><circle cx="5.5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18.5" cy="12" r="1.4" /></>,
  "more-vertical": <><circle cx="12" cy="5.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="18.5" r="1.4" /></>,
  navigation: <path d="M21 3 3 10.5l8 2.5 2.5 8L21 3Z" />,
  package: <><path d="M3 8 12 4l9 4-9 4-9-4Z" /><path d="M3 8v9l9 4 9-4V8" /><line x1="12" y1="12" x2="12" y2="21" /></>,
  percent: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></>,
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />,
  "phone-incoming": <><path d="M4 11.5h3l1.3 3.4-1.7 1.3a9 9 0 0 0 3.2 3.2l1.3-1.7 3.4 1.3v2.5a1.7 1.7 0 0 1-1.9 1.7" /><polyline points="21 3 15 9" /><polyline points="15 4 15 9 20 9" /></>,
  "pie-chart": <><path d="M12 3a9 9 0 1 0 9 9h-9V3Z" /><path d="M14.5 3.5A9 9 0 0 1 20.5 9.5h-6v-6Z" /></>,
  pin: <><path d="M12 21v-7" /><path d="M8 3h8l-1 5 2.5 3.5h-11L9 8 8 3Z" /></>,
  pinterest: <><circle cx="12" cy="12" r="9" /><path d="M10 20.5 12.4 13" /><path d="M8.8 13.6a3.6 3.6 0 0 1-.6-2.1c0-2.4 2-4.4 4.6-4.4 2.3 0 3.9 1.5 3.9 3.6 0 2.5-1.4 4.4-3.3 4.4-1 0-1.8-.8-1.6-1.8" /></>,
  plug: <><path d="M9 3v5M15 3v5" /><path d="M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0V8Z" /><line x1="12" y1="16" x2="12" y2="21" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  power: <><path d="M7.5 6.5a7.5 7.5 0 1 0 9 0" /><line x1="12" y1="3" x2="12" y2="11" /></>,
  printer: <><path d="M7 8V3.5h10V8" /><rect x="3" y="8" width="18" height="8" rx="1.8" /><path d="M7 13h10v7.5H7V13Z" /></>,
  "qr-code": <><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="7" rx="1.3" /><rect x="3" y="14" width="7" height="7" rx="1.3" /><line x1="14" y1="14" x2="17" y2="14" /><line x1="20" y1="14" x2="21" y2="14" /><line x1="14" y1="18" x2="14" y2="21" /><line x1="18" y1="17.5" x2="21" y2="17.5" /><line x1="18" y1="21" x2="21" y2="21" /></>,
  quote: <><path d="M9.5 6C6.5 7.2 5 9.5 5 13v5h5v-6H7.5c0-2.2.7-3.7 2-4.4L9.5 6Z" /><path d="M18.5 6c-3 1.2-4.5 3.5-4.5 7v5h5v-6h-2.5c0-2.2.7-3.7 2-4.4L18.5 6Z" /></>,
  receipt: <><path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21V3Z" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /></>,
  redo: <><polyline points="15 5 20 10 15 15" /><path d="M20 10h-9a6 6 0 0 0 0 12h3" /></>,
  refresh: <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.5 9a8.5 8.5 0 0 1 14-3.3L23 10M1 14l5.5 4.3A8.5 8.5 0 0 0 20.5 15" /></>,
  return: <><path d="M3 8 12 4l9 4-9 4-9-4Z" /><path d="M3 8v9l9 4 9-4V8" /><polyline points="14 15 11 17.5 14 20" /><path d="M11 17.5h3.5a2.5 2.5 0 0 0 0-5" /></>,
  ring: <><circle cx="12" cy="14.5" r="6" /><path d="M9.5 8.8 12 3l2.5 5.8" /><path d="M9.8 8.4 12 6l2.2 2.4" /></>,
  route: <><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="5.5" r="2.5" /><path d="M8 18.5h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-5h6" /></>,
  rupee: <><path d="M7 4h10" /><path d="M7 8.5h10" /><path d="M14.5 4c0 3.2-1.9 4.5-4.7 4.5H7l7.5 11.5" /></>,
  scale: <><line x1="12" y1="4" x2="12" y2="20" /><line x1="7" y1="20" x2="17" y2="20" /><path d="M4 8h16" /><path d="M4 8 1.5 13h5L4 8Z" /><path d="M20 8l-2.5 5h5L20 8Z" /></>,
  scissors: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><line x1="20" y1="4" x2="8.2" y2="16.4" /><line x1="20" y1="20" x2="8.2" y2="7.6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  send: <><path d="M21 3 3 10.5l7 2.8L12.8 21 21 3Z" /><line x1="10" y1="13.3" x2="21" y2="3" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="1.6" /><rect x="3" y="14" width="18" height="6" rx="1.6" /><line x1="7" y1="7" x2="7.01" y2="7" /><line x1="7" y1="17" x2="7.01" y2="17" /></>,
  share: <><circle cx="17.5" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /><line x1="8.3" y1="10.7" x2="15.2" y2="6.8" /><line x1="8.3" y1="13.3" x2="15.2" y2="17.2" /></>,
  sheets: <><path d="M6 3h8l5 5v13H6V3Z" /><path d="M14 3v5h5" /><rect x="9" y="11.5" width="7" height="6.5" /><line x1="9" y1="14.8" x2="16" y2="14.8" /><line x1="12.5" y1="11.5" x2="12.5" y2="18" /></>,
  "shield-alert": <><path d="M12 3 20 6v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3Z" /><line x1="12" y1="8.5" x2="12" y2="13" /><circle cx="12" cy="15.8" r="0.7" fill="currentColor" stroke="none" /></>,
  "shield-check": <><path d="M12 3 20 6v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3Z" /><polyline points="8.5 12 11 14.5 15.5 9.5" /></>,
  "shield-off": <><path d="M8.4 4.6 12 3l8 3v6c0 2.2-.7 4-1.8 5.4" /><path d="M4 7v5c0 5 3.4 7.8 8 9 1.6-.4 3-1.1 4.2-2" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  shopify: <><path d="M6 7.5h12L20 20H4L6 7.5Z" /><path d="M9 9.5V7a3 3 0 0 1 6 0v2.5" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><line x1="9.5" y1="4" x2="9.5" y2="20" /></>,
  siren: <><path d="M6 16a6 6 0 0 1 12 0v2H6v-2Z" /><rect x="4" y="18" width="16" height="3" rx="1.2" /><line x1="12" y1="4" x2="12" y2="7" /><line x1="4.5" y1="7.5" x2="6.5" y2="9" /><line x1="19.5" y1="7.5" x2="17.5" y2="9" /></>,
  slash: <><circle cx="12" cy="12" r="9" /><line x1="18.4" y1="5.6" x2="5.6" y2="18.4" /></>,
  sliders: <><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="9" cy="8" r="2.2" /><circle cx="15.5" cy="16" r="2.2" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4.4 4.4 0 0 0 7 0" /><circle cx="9.3" cy="9.8" r="0.8" fill="currentColor" stroke="none" /><circle cx="14.7" cy="9.8" r="0.8" fill="currentColor" stroke="none" /></>,
  sort: <><line x1="4" y1="7" x2="14" y2="7" /><line x1="4" y1="12" x2="11" y2="12" /><line x1="4" y1="17" x2="8" y2="17" /><polyline points="16 13 19 16.5 22 13" /><line x1="19" y1="5" x2="19" y2="16.5" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></>,
  star: <path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.9l6.1-.8L12 3.5Z" />,
  "star-half": <><path d="M12 3.5v15.9l-5.4 2.9 1.1-6L3.2 9.9l6.1-.8L12 3.5Z" /><path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.3 1.1 6L12 17.4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="22" /><line x1="2" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="22" y2="12" /><line x1="5" y1="5" x2="6.8" y2="6.8" /><line x1="17.2" y1="17.2" x2="19" y2="19" /><line x1="5" y1="19" x2="6.8" y2="17.2" /><line x1="17.2" y1="6.8" x2="19" y2="5" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="10" y1="9.5" x2="10" y2="20" /></>,
  tag: <><path d="M3 3h8l10 10-8 8L3 11V3Z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  tags: <><path d="M2 4h6.5l8 8-6.5 6.5L2 10V4Z" /><circle cx="6" cy="8" r="1.2" /><path d="M11 3h4l7 7-4.5 4.5" /></>,
  telegram: <><path d="M21 4 2.8 11.2l5.4 1.9L21 4Z" /><path d="M21 4 10.6 20l-2.4-6.9L21 4Z" /><path d="M8.2 13.1 8 18l2.6-2.6" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="7 10 9.5 12.5 7 15" /><line x1="12" y1="15" x2="16.5" y2="15" /></>,
  "thumbs-down": <><path d="M7 13.5 11 21c1.6 0 2.5-1.1 2.5-2.5V14.5H19a1.8 1.8 0 0 0 1.7-2.3l-1.7-6.4A2.2 2.2 0 0 0 16.9 4H7" /><rect x="3" y="4" width="4" height="9.5" rx="1.2" /></>,
  "thumbs-up": <><path d="M7 10.5 11 3c1.6 0 2.5 1.1 2.5 2.5V9.5H19a1.8 1.8 0 0 1 1.7 2.3l-1.7 6.4A2.2 2.2 0 0 1 16.9 20H7" /><rect x="3" y="10.5" width="4" height="9.5" rx="1.2" /></>,
  "timer-off": <><path d="M6.3 7.8a8 8 0 1 0 11 11.2" /><path d="M8.5 4.7A8 8 0 0 1 19.5 15.5" /><line x1="9.5" y1="2.5" x2="14.5" y2="2.5" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  "toggle-off": <><rect x="2.5" y="7" width="19" height="10" rx="5" /><circle cx="7.5" cy="12" r="2.6" /></>,
  "toggle-on": <><rect x="2.5" y="7" width="19" height="10" rx="5" /><circle cx="16.5" cy="12" r="2.6" fill="currentColor" stroke="none" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  "trending-down": <><polyline points="3 7 9 13 13 9 21 17" /><polyline points="15 17 21 17 21 11" /></>,
  "trending-up": <><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></>,
  truck: <><path d="M2 6h11v10H2V6Z" /><path d="M13 9h4.5L21 12.5V16h-8" /><circle cx="6.5" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" /></>,
  undo: <><polyline points="9 5 4 10 9 15" /><path d="M4 10h9a6 6 0 0 1 0 12h-3" /></>,
  unlock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 7.5-2" /></>,
  upload: <><line x1="12" y1="15" x2="12" y2="3" /><polyline points="7 8 12 3 17 8" /><path d="M4 19h16" /></>,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c0-3.9 3.4-6.6 7.5-6.6s7.5 2.7 7.5 6.6" /></>,
  "user-check": <><circle cx="10" cy="8" r="3.4" /><path d="M3.5 20c0-3.7 2.9-6.3 6.5-6.3 1 0 2 .2 2.8.6" /><polyline points="15 17.5 17.5 20 21 15.5" /></>,
  "user-plus": <><circle cx="10" cy="8" r="3.4" /><path d="M3.5 20c0-3.7 2.9-6.3 6.5-6.3 1.2 0 2.3.3 3.2.8" /><line x1="17.5" y1="13" x2="17.5" y2="20" /><line x1="14" y1="16.5" x2="21" y2="16.5" /></>,
  "user-x": <><circle cx="10" cy="8" r="3.4" /><path d="M3.5 20c0-3.7 2.9-6.3 6.5-6.3 1 0 2 .2 2.8.6" /><line x1="15.5" y1="15.5" x2="20.5" y2="20.5" /><line x1="20.5" y1="15.5" x2="15.5" y2="20.5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.3" /><path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1.3" /></>,
  webhook: <><path d="M9 9a3.5 3.5 0 1 1 5 3.2L11.5 17" /><circle cx="7" cy="18" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="M9.5 18h5" /><path d="M15.5 15.8 13 11" /></>,
  whatsapp: <><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.3A9 9 0 1 0 12 3Z" /><path d="M9 8.5c0 3.3 2.7 6 6 6 .8 0 1.2-.5 1.2-1.2l-1.9-1-1 1a6.6 6.6 0 0 1-2.3-2.3l1-1-1-1.9c-.7 0-2 .3-2 1.4Z" /></>,
  "wifi-off": <><path d="M8.5 14.5a5 5 0 0 1 7 0" /><path d="M5 11a10 10 0 0 1 4-2.5M19 11a10 10 0 0 0-6-2.9" /><circle cx="12" cy="18.5" r="0.9" fill="currentColor" stroke="none" /><line x1="3" y1="3" x2="21" y2="21" /></>,
  x: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
  "x-circle": <><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></>,
  "x-twitter": <><path d="M4 4l7.2 9.4L4.4 21" /><path d="M20 21l-7.2-9.4L19.6 4" /><path d="M4 4h3.6M16.4 21H20" /></>,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10.5 9.5 15 12l-4.5 2.5v-5Z" /></>,
  zap: <path d="M13 2 6 13h5l-1 9 8-12h-5l1-8Z" />,
  "zap-off": <><path d="M13 3 7 13h3l-.7 8" /><path d="M11.5 11H17l-3.2 5" /></>,
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
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      {...rest}
    >
      {body}
    </svg>
  );
}
