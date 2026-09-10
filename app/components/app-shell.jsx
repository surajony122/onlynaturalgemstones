/**
 * The app's own chrome — sidebar nav (grouped, with badges + a health
 * dot), a breadcrumb header with a global attention banner and a
 * Refresh button, and a Cmd+K command palette — replacing both Shopify's
 * own sidebar (moved to an in-app tab bar in an earlier pass) and that
 * tab bar itself (this pass). Lives entirely inside app.jsx's layout
 * route; every child route now renders its own content directly (no
 * <s-page> wrapper) into the <main> this shell provides.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useRevalidator } from "react-router";
import { Icon, brand } from "./table-kit";

// Every real destination in the app, grouped exactly like the ONG
// Controls design pass — same 7 pages that used to live in the flat tab
// bar, plus the template's own demo page folded into System (kept
// reachable rather than silently dropped, just deprioritized).
export const NAV_GROUPS = [
  {
    label: "Home",
    items: [{ id: "overview", href: "/app/overview", label: "Overview", icon: "grid", end: true }],
  },
  {
    label: "Catalog",
    items: [{ id: "pricing", href: "/app", label: "Jewelry Pricing", icon: "tag", end: true }],
  },
  {
    label: "Leads",
    items: [
      { id: "astro", href: "/app/astro-leads", label: "Astro Leads", icon: "users", badgeKey: "astro" },
      { id: "wishlist", href: "/app/wishlist-leads", label: "Wishlist Leads", icon: "heart", badgeKey: "wishlist" },
    ],
  },
  {
    label: "Messaging",
    items: [{ id: "whatsapp", href: "/app/whatsapp-events", label: "Messages & Orders", icon: "message", badgeKey: "whatsapp" }],
  },
  {
    label: "Orders",
    items: [{ id: "invoices", href: "/app/invoices", label: "GST Invoices", icon: "tag" }],
  },
  {
    label: "System",
    items: [
      { id: "server", href: "/app/server-health", label: "System Health", icon: "server" },
      { id: "settings", href: "/app/settings", label: "Settings", icon: "gear" },
      { id: "additional", href: "/app/additional", label: "Additional page", icon: "package" },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })));

function matchPath(pathname, item) {
  if (item.end) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function currentPageInfo(pathname) {
  const hit = ALL_ITEMS.find((it) => matchPath(pathname, it));
  return hit || { label: "ONG Controls", group: "" };
}

// ---- Command palette ---------------------------------------------------

function CommandPalette({ open, onClose, onRefresh }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    const items = ALL_ITEMS.map((it) => ({ kind: "nav", href: it.href, label: `Go to ${it.label}`, hint: it.group, icon: it.icon }));
    items.push({ kind: "act", label: "Refresh all data", hint: "Action", icon: "refresh", onRun: onRefresh });
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)) : items;
  }, [query, onRefresh]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % Math.max(results.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = results[index];
        if (hit) run(hit);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, index]);

  const run = (item) => {
    onClose();
    if (item.kind === "act") item.onRun?.();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,20,31,0.34)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 200,
        animation: "ongFade 0.14s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          background: "#fff",
          border: `1px solid ${brand.border}`,
          borderRadius: "16px",
          boxShadow: "0 24px 60px -18px rgba(22,20,31,0.45)",
          overflow: "hidden",
          animation: "ongPop 0.18s cubic-bezier(.22,.9,.3,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: `1px solid ${brand.divider}` }}>
          <Icon name="search" size={16} color={brand.faint} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Jump to a page or run an action…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: "15px", color: brand.ink, background: "transparent" }}
          />
          <span style={{ fontFamily: brand.mono, fontSize: "10.5px", padding: "3px 6px", border: `1px solid ${brand.border}`, borderRadius: "5px", color: brand.faint }}>ESC</span>
        </div>
        <div style={{ maxHeight: "340px", overflowY: "auto", padding: "8px" }}>
          {results.map((item, i) => {
            const active = i === index;
            const body = (
              <>
                <Icon name={item.icon} size={15} color={active ? brand.accent : brand.faint} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: "13.5px", fontWeight: 500, color: brand.ink }}>{item.label}</span>
                <span style={{ fontSize: "11.5px", color: brand.faint }}>{item.hint}</span>
              </>
            );
            const rowStyle = {
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "11px",
              padding: "11px 12px",
              border: "none",
              borderRadius: "10px",
              background: active ? brand.accentTint : "transparent",
              textAlign: "left",
              textDecoration: "none",
              cursor: "pointer",
            };
            return item.kind === "nav" ? (
              <Link key={item.label} to={item.href} onClick={onClose} onMouseEnter={() => setIndex(i)} style={rowStyle}>
                {body}
              </Link>
            ) : (
              <button key={item.label} type="button" onClick={() => run(item)} onMouseEnter={() => setIndex(i)} style={rowStyle}>
                {body}
              </button>
            );
          })}
          {results.length === 0 && <div style={{ padding: "34px 16px", textAlign: "center", fontSize: "13px", color: brand.muted }}>Nothing matches "{query}".</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "10px 18px", borderTop: `1px solid ${brand.divider}`, background: brand.panel, fontSize: "11.5px", color: brand.faint }}>
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

// ---- Sidebar ------------------------------------------------------------

function Sidebar({ pathname, badges }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const revalidator = useRevalidator();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const healthy = Object.values(badges || {}).every((n) => !n);

  return (
    <>
      <nav
        style={{
          width: "246px",
          flexShrink: 0,
          background: "#fff",
          borderRight: `1px solid ${brand.border}`,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          height: "100vh",
          position: "sticky",
          top: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "20px 20px 18px" }}>
          <span style={{ width: "32px", height: "32px", borderRadius: "9px", background: brand.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="diamond" size={17} color="#fff" style={{ strokeWidth: 1.7 }} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14.5px", fontWeight: 700, color: brand.ink, letterSpacing: "-0.01em" }}>ONG Controls</span>
            <span style={{ fontSize: "11.5px", color: brand.faint }}>Only Natural Gemstones</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          style={{
            margin: "0 14px 14px",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            padding: "9px 11px",
            border: `1px solid ${brand.border}`,
            background: brand.panel,
            borderRadius: "10px",
            color: brand.muted,
            fontSize: "13px",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <Icon name="search" size={14} color="currentColor" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Search or jump to…</span>
          <span style={{ fontFamily: brand.mono, fontSize: "10.5px", padding: "2px 5px", border: `1px solid ${brand.border}`, borderRadius: "5px", background: "#fff", color: brand.faint }}>⌘K</span>
        </button>

        {NAV_GROUPS.map((g) => (
          <div key={g.label} style={{ padding: "0 14px 4px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: brand.faint, padding: "10px 8px 6px" }}>{g.label}</div>
            {g.items.map((item) => {
              const active = matchPath(pathname, item);
              const badge = item.badgeKey ? badges?.[item.badgeKey] : 0;
              return (
                <NavLink
                  key={item.id}
                  to={item.href}
                  end={item.end}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "9px 10px",
                    marginBottom: "2px",
                    border: "none",
                    borderRadius: "9px",
                    textAlign: "left",
                    fontSize: "13.5px",
                    fontWeight: active ? 600 : 500,
                    color: active ? brand.accent : brand.body,
                    background: active ? brand.accentTint : "transparent",
                    textDecoration: "none",
                  }}
                >
                  <Icon name={item.icon} size={16} color="currentColor" style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {!!badge && (
                    <span
                      style={{
                        minWidth: "19px",
                        height: "19px",
                        padding: "0 6px",
                        borderRadius: "999px",
                        background: brand.danger,
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}

        <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: `1px solid ${brand.divider}`, display: "flex", alignItems: "center", gap: "9px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: healthy ? brand.success : brand.danger,
              flexShrink: 0,
              animation: "ongPulse 2.4s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: "12px", color: brand.muted, lineHeight: 1.4 }}>
            {healthy ? "All systems OK" : "Some checks need attention"}
          </span>
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onRefresh={() => revalidator.revalidate()} />
    </>
  );
}

// ---- Header ---------------------------------------------------------------

function Header({ pathname, healthy, attentionCount }) {
  const revalidator = useRevalidator();
  const page = currentPageInfo(pathname);
  const refreshing = revalidator.state === "loading";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "0 28px",
        height: "60px",
        flexShrink: 0,
        background: "rgba(255,255,255,0.86)",
        backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${brand.border}`,
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        {page.group && <span style={{ fontSize: "12.5px", color: brand.faint }}>{page.group}</span>}
        {page.group && <Icon name="chevron-right" size={13} color={brand.faint} style={{ flexShrink: 0 }} />}
        <span style={{ fontSize: "13.5px", fontWeight: 600, color: brand.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        {!healthy && (
          <Link
            to="/app/overview"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              fontSize: "12px",
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: "999px",
              color: brand.danger,
              background: brand.dangerBg,
              border: `1px solid ${brand.dangerLine}`,
              textDecoration: "none",
            }}
          >
            <Icon name="alert" size={13} color="currentColor" />
            {attentionCount} issue{attentionCount === 1 ? "" : "s"} need{attentionCount === 1 ? "s" : ""} you
          </Link>
        )}
        <button
          type="button"
          onClick={() => revalidator.revalidate()}
          title="Refresh data"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 12px",
            border: `1px solid ${brand.border}`,
            background: "#fff",
            borderRadius: "9px",
            fontSize: "12.5px",
            fontWeight: 500,
            color: brand.body,
            cursor: "pointer",
          }}
        >
          <Icon name="refresh" size={13} color="currentColor" style={{ animation: refreshing ? "ongSpin 0.8s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>
    </header>
  );
}

// ---- Shell ------------------------------------------------------------

export function AppShell({ attention, children }) {
  const { pathname } = useLocation();
  const healthy = attention?.healthy ?? true;
  const attentionCount = attention?.items?.length || 0;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: brand.page, fontSize: "14px" }}>
      <Sidebar pathname={pathname} badges={attention?.badges} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Header pathname={pathname} healthy={healthy} attentionCount={attentionCount} />
        <main style={{ flex: 1, overflowY: "auto", padding: "28px 28px 72px" }}>
          <div style={{ maxWidth: "1180px", margin: "0 auto" }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
