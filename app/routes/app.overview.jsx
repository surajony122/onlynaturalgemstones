/**
 * Home dashboard -- the page the app opens on. One screen that answers
 * "is everything OK, and what happened today?" and shows a live panel for
 * every part of the app (leads, wishlist, messages, invoices, pricing,
 * gemstone details, currencies, connections) with a link into each.
 *
 * Everything here is DB-only (no live calls to Gmail / Interakt / Shopify),
 * because the app opens on this page and it must stay fast; the live
 * connection checks live on the System Health page.
 *
 * "Today"/"yesterday" below mean since local midnight on the SERVER's
 * clock (this app doesn't do per-shop timezone conversion anywhere else
 * either, so this stays consistent with that rather than introducing a
 * new timezone concept just for this page).
 */
import { useEffect } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAttentionSummary } from "../utils/attention.server";
import { runAttentionAction } from "../utils/attentionActions.server";
import { useToast } from "../components/toast";
import { getAppSettings, ratesFromAppSettings } from "../utils/appSettings.server";
import { getCurrencyCountryConfig } from "../utils/currencyCountries.server";
import { getGemStoneRows } from "../utils/gemStoneDetails.server";
import { brand, Icon, Card, PageHeader, PageIn } from "../components/table-kit";

const DAY_MS = 24 * 60 * 60 * 1000;

async function safe(promise, fallback, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`[app.overview] ${label} failed:`, err);
    return fallback;
  }
}

/** Counts per day for the last 7 days (oldest first) from a list of dates. */
function lastSevenDays(dates, todayStart) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(todayStart.getTime() - i * DAY_MS);
    days.push({ label: start.toLocaleDateString("en-IN", { weekday: "short" }), start: start.getTime(), count: 0 });
  }
  for (const d of dates) {
    const t = new Date(d).getTime();
    for (let i = days.length - 1; i >= 0; i--) {
      if (t >= days[i].start) {
        days[i].count += 1;
        break;
      }
    }
  }
  return days.map((d) => ({ label: d.label, count: d.count }));
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const weekStart = new Date(todayStart.getTime() - 6 * DAY_MS);

  const [
    leadsToday,
    leadsYesterday,
    wishlistToday,
    wishlistYesterday,
    whatsappToday,
    whatsappYesterday,
    ordersToday,
    ordersYesterday,
    returnsRefundsToday,
    returnsRefundsYesterday,
    invoicesToday,
    invoicesYesterday,
  ] = await Promise.all([
    prisma.astroLead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.astroLead.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.wishlistLead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.wishlistLead.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.whatsAppMessageEvent.count({ where: { receivedAt: { gte: todayStart }, eventType: "message_api_sent" } }),
    prisma.whatsAppMessageEvent.count({ where: { receivedAt: { gte: yesterdayStart, lt: todayStart }, eventType: "message_api_sent" } }),
    prisma.orderProcessingNotification.count({ where: { notifiedAt: { gte: todayStart } } }),
    prisma.orderProcessingNotification.count({ where: { notifiedAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.orderReturnEmailNotification.count({ where: { notifiedAt: { gte: todayStart } } }),
    prisma.orderReturnEmailNotification.count({ where: { notifiedAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.orderInvoice.count({ where: { lastSentAt: { gte: todayStart } } }),
    prisma.orderInvoice.count({ where: { lastSentAt: { gte: yesterdayStart, lt: todayStart } } }),
  ]);

  const attention = await safe(getAttentionSummary(), { items: [], badges: {}, healthy: true }, "attention");

  const [astroWeek, whatsappWeek, recentAstro, recentWishlist, recentMessages, invoicesWeek, lastInvoice, totals] = await Promise.all([
    safe(prisma.astroLead.findMany({ where: { createdAt: { gte: weekStart } }, select: { createdAt: true } }), [], "astro week"),
    safe(
      prisma.whatsAppMessageEvent.findMany({ where: { receivedAt: { gte: weekStart }, eventType: "message_api_sent" }, select: { receivedAt: true } }),
      [],
      "whatsapp week"
    ),
    safe(
      prisma.astroLead.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, email: true, lifeStoneGem: true, createdAt: true, calculationOk: true, emailSendStatus: true, whatsappSendStatus: true },
      }),
      [],
      "recent astro"
    ),
    safe(
      prisma.wishlistLead.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, email: true, createdAt: true, products: true, emailSendStatus: true, whatsappSendStatus: true },
      }),
      [],
      "recent wishlist"
    ),
    safe(
      prisma.whatsAppMessageEvent.findMany({
        orderBy: { receivedAt: "desc" },
        take: 6,
        select: { id: true, phone: true, status: true, eventType: true, failureReason: true, receivedAt: true },
      }),
      [],
      "recent messages"
    ),
    safe(prisma.orderInvoice.count({ where: { lastSentAt: { gte: weekStart } } }), 0, "invoices week"),
    safe(prisma.orderInvoice.findFirst({ orderBy: { lastSentAt: "desc" }, select: { orderName: true, invoiceNumber: true, status: true, lastSentAt: true } }), null, "last invoice"),
    Promise.all([prisma.astroLead.count(), prisma.wishlistLead.count()]).catch(() => [0, 0]),
  ]);

  const settings = await safe(getAppSettings(shop), {}, "settings");
  const rates = ratesFromAppSettings(settings);

  const currencyCfg = await safe(getCurrencyCountryConfig(shop), { countries: {} }, "currency config");
  const enabledCountries = Object.values(currencyCfg.countries || {}).filter((c) => c && c.enabled && c.currency);
  const currencyCount = new Set(enabledCountries.map((c) => c.currency)).size;

  const gemRows = await safe(getGemStoneRows(shop), [], "gemstone rows");
  const gemCustomised = gemRows.filter((r) => Object.values(r.values || {}).some((v) => String(v || "").trim())).length;

  const iso = (d) => (d ? new Date(d).toISOString() : null);

  return {
    stats: {
      leadsToday: { value: leadsToday, delta: leadsToday - leadsYesterday },
      wishlistToday: { value: wishlistToday, delta: wishlistToday - wishlistYesterday },
      whatsappSentToday: { value: whatsappToday, delta: whatsappToday - whatsappYesterday },
      ordersNotifiedToday: { value: ordersToday, delta: ordersToday - ordersYesterday },
      returnsRefundsToday: { value: returnsRefundsToday, delta: returnsRefundsToday - returnsRefundsYesterday },
      invoicesToday: { value: invoicesToday, delta: invoicesToday - invoicesYesterday },
    },
    series: {
      leads: lastSevenDays(astroWeek.map((l) => l.createdAt), todayStart),
      whatsapp: lastSevenDays(whatsappWeek.map((m) => m.receivedAt), todayStart),
    },
    attention,
    recentAstro: recentAstro.map((l) => ({ ...l, createdAt: iso(l.createdAt) })),
    recentWishlist: recentWishlist.map((l) => ({
      id: l.id,
      email: l.email,
      createdAt: iso(l.createdAt),
      itemCount: Array.isArray(l.products) ? l.products.length : 0,
      emailSendStatus: l.emailSendStatus,
      whatsappSendStatus: l.whatsappSendStatus,
    })),
    recentMessages: recentMessages.map((m) => ({
      id: m.id,
      phoneTail: m.phone ? String(m.phone).replace(/\D/g, "").slice(-4) : "",
      status: m.status,
      eventType: m.eventType,
      failureReason: m.failureReason,
      receivedAt: iso(m.receivedAt),
    })),
    invoices: { week: invoicesWeek, last: lastInvoice ? { ...lastInvoice, lastSentAt: iso(lastInvoice.lastSentAt) } : null },
    totals: { astro: totals[0], wishlist: totals[1] },
    pricing: rates,
    store: { gemTotal: gemRows.length, gemCustomised, countries: enabledCountries.length, currencies: currencyCount },
    connections: {
      gmail: !!(settings.gmailUser && settings.gmailAppPassword),
      whatsapp: !!settings.interaktApiKey,
      sheets: !!(settings.sheetsRelayUrl || settings.astroLeadsSpreadsheetId),
      places: !!settings.googlePlacesApiKey,
    },
  };
};

// Retry / Mark-as-resolved buttons on the "Needs attention" panel.
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  return runAttentionAction({
    admin,
    shop: session.shop,
    intent: String(form.get("intent") || ""),
    kind: String(form.get("kind") || ""),
    id: String(form.get("id") || ""),
  });
};

// ---------------------------------------------------------------- helpers

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function deltaLabel(delta) {
  if (delta > 0) return { label: `+${delta} vs yesterday`, color: brand.success };
  if (delta < 0) return { label: `${delta} vs yesterday`, color: brand.danger };
  return { label: "same as yesterday", color: brand.muted };
}

function statusOf(status) {
  const s = String(status || "");
  if (/^(FAILED|threw)/i.test(s) || /fail/i.test(s)) return "bad";
  if (/^OK/i.test(s) || /sent|deliver|read/i.test(s)) return "good";
  if (/^skipped/i.test(s)) return "skip";
  return "pending";
}

const TONES = {
  good: { color: brand.success, bg: brand.successBg, line: brand.successLine },
  bad: { color: brand.danger, bg: brand.dangerBg, line: brand.dangerLine },
  warn: { color: brand.warn, bg: brand.warnBg, line: brand.warnLine },
  info: { color: brand.accent, bg: brand.accentTint, line: brand.accentLine },
  skip: { color: brand.muted, bg: brand.panel, line: brand.border },
  pending: { color: brand.muted, bg: brand.panel, line: brand.border },
};

function Tag({ tone = "pending", children, title }) {
  const t = TONES[tone] || TONES.pending;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 9px",
        borderRadius: "999px",
        border: `1px solid ${t.line}`,
        background: t.bg,
        color: t.color,
        fontSize: "11.5px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function IconTile({ name, color, bg }) {
  return (
    <span
      style={{
        width: "34px",
        height: "34px",
        borderRadius: "10px",
        background: bg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={name} size={17} color={color} />
    </span>
  );
}

// Seven small bars, oldest to today, today's in the accent colour.
function Spark({ data, color }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "30px" }} aria-label="Last 7 days">
      {data.map((d, i) => (
        <span
          key={i}
          title={`${d.label}: ${d.count}`}
          style={{
            width: "7px",
            height: `${Math.max(3, Math.round((d.count / max) * 30))}px`,
            borderRadius: "2px",
            background: i === data.length - 1 ? color : brand.border,
          }}
        />
      ))}
    </div>
  );
}

function StatCard({ icon, tint, color, label, stat, spark }) {
  const d = deltaLabel(stat.delta);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <IconTile name={icon} color={color} bg={tint} />
        <span style={{ fontSize: "12.5px", color: brand.muted, lineHeight: 1.3 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", color: brand.ink, lineHeight: 1 }}>{stat.value}</div>
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: d.color, marginTop: "7px" }}>{d.label}</div>
        </div>
        {spark && <Spark data={spark} color={color} />}
      </div>
    </Card>
  );
}

function SectionTitle({ icon, children }) {
  return (
    <h2
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: brand.faint,
        margin: "30px 0 12px",
      }}
    >
      <Icon name={icon} size={14} color={brand.faint} />
      {children}
    </h2>
  );
}

function Panel({ icon, color, tint, title, subtitle, to, linkLabel = "Open", children }) {
  return (
    <Card padding="0" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "15px 18px", borderBottom: `1px solid ${brand.divider}` }}>
        <IconTile name={icon} color={color} bg={tint} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: brand.ink }}>{title}</div>
          {subtitle && <div style={{ fontSize: "12px", color: brand.muted, marginTop: "1px" }}>{subtitle}</div>}
        </div>
        {to && (
          <Link
            to={to}
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12.5px", fontWeight: 600, color: brand.accent, textDecoration: "none", flexShrink: 0 }}
          >
            {linkLabel}
            <Icon name="chevron-right" size={12} color="currentColor" />
          </Link>
        )}
      </div>
      <div style={{ padding: "6px 18px 14px", flex: 1 }}>{children}</div>
    </Card>
  );
}

function Row({ children, last }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 0",
        borderBottom: last ? "none" : `1px solid ${brand.divider}`,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <p style={{ margin: "14px 0 6px", fontSize: "12.5px", color: brand.muted }}>{children}</p>;
}

function Dot({ tone }) {
  const t = TONES[tone] || TONES.pending;
  return <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: tone === "pending" || tone === "skip" ? brand.border : t.color, flexShrink: 0 }} />;
}

// ---------------------------------------------------------------- attention

const smallButton = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 12px",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// The buttons under one failure. Retry re-sends just that message and writes
// the new result back, so a successful retry clears the failure from this
// panel; "Mark as resolved" clears it without sending anything.
function FailureActions({ d }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const running = busy ? fetcher.formData?.get("intent") : null;
  const result = fetcher.state === "idle" ? fetcher.data : null;

  useEffect(() => {
    if (!result) return;
    if (result.intent === "retry") {
      if (result.ok) toast.show("Sent again: " + d.subject);
      else toast.show("Still failing: " + (result.status || result.error || "unknown error"), { isError: true });
    } else if (result.intent === "dismiss") {
      if (result.ok) toast.show("Marked as resolved");
      else toast.show(result.error || "Could not mark as resolved", { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (!d.canRetry && !d.canDismiss) return null;
  const run = (intent) => fetcher.submit({ intent, kind: d.kind, id: d.id }, { method: "post" });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      {d.canRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Send this message again?\n\n" + d.subject + " (" + d.source + ")")) run("retry");
          }}
          style={{ ...smallButton, border: "1px solid " + brand.accent, background: brand.accent, color: "#fff", opacity: busy ? 0.7 : 1 }}
        >
          <Icon name="refresh" size={12} color="currentColor" style={{ animation: running === "retry" ? "ongSpin 0.8s linear infinite" : "none" }} />
          {running === "retry" ? "Retrying…" : "Retry now"}
        </button>
      )}
      {d.canDismiss && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Mark this as resolved without sending anything?\n\nThe original error stays on record. Use this when the cause is already fixed and sending again would only confuse the customer.")) run("dismiss");
          }}
          style={{ ...smallButton, border: "1px solid " + brand.border, background: "#fff", color: brand.body, opacity: busy ? 0.7 : 1 }}
        >
          <Icon name="check" size={12} color="currentColor" />
          {running === "dismiss" ? "Saving…" : "Mark as resolved"}
        </button>
      )}
      {result && result.intent === "retry" && !result.ok && (
        <span style={{ fontSize: "11.5px", color: brand.danger }}>Still failing. See the updated error above.</span>
      )}
    </div>
  );
}

function AttentionPanel({ attention }) {
  if (attention.healthy) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "14px 20px",
          background: brand.successBg,
          border: `1px solid ${brand.successLine}`,
          borderRadius: "14px",
          marginBottom: "20px",
        }}
      >
        <Icon name="check-circle" size={17} color={brand.success} />
        <span style={{ fontSize: "14px", fontWeight: 700, color: brand.success }}>All clear</span>
        <span style={{ fontSize: "12.5px", color: brand.muted }}>No failed messages, leads or invoices in the last 7 days.</span>
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: `1px solid ${brand.dangerLine}`, borderRadius: "14px", boxShadow: brand.shadow, overflow: "hidden", marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "13px 20px", background: brand.dangerBg, borderBottom: `1px solid ${brand.dangerLine}` }}>
        <Icon name="alert-triangle" size={16} color={brand.danger} />
        <span style={{ fontSize: "14px", fontWeight: 700, color: brand.danger }}>Needs attention</span>
        <span style={{ fontSize: "12.5px", color: brand.muted }}>
          {attention.items.length} thing{attention.items.length === 1 ? "" : "s"} to look at, from the last 7 days
        </span>
      </div>
      {attention.items.map((a) => (
        <div key={a.id} style={{ padding: "16px 20px", borderBottom: `1px solid ${brand.divider}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: a.severity === "warn" ? brand.warn : brand.danger, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 600, color: brand.ink }}>{a.title}</div>
            <Link
              to={a.href}
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 13px",
                border: `1px solid ${brand.border}`,
                background: "#fff",
                borderRadius: "8px",
                fontSize: "12.5px",
                fontWeight: 600,
                color: brand.accent,
                textDecoration: "none",
              }}
            >
              {a.action}
              <Icon name="chevron-right" size={12} color="currentColor" />
            </Link>
          </div>

          {a.details && a.details.length > 0 && (
            <div style={{ margin: "12px 0 0 22px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {a.details.map((d, i) => (
                <div key={i} style={{ background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: brand.ink }}>{d.subject}</span>
                    <Tag tone="bad">{d.source}</Tag>
                    {d.when && <span style={{ fontSize: "11.5px", color: brand.faint }}>{timeAgo(d.when)}</span>}
                  </div>
                  <div style={{ fontFamily: brand.mono, fontSize: "11.5px", color: brand.body, lineHeight: 1.55, wordBreak: "break-word" }}>{d.reason}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginTop: "9px" }}>
                    {d.fix ? (
                      <Link to={d.fix.href} style={{ fontSize: "12px", fontWeight: 600, color: brand.accent, textDecoration: "none" }}>
                        {d.fix.label} →
                      </Link>
                    ) : (
                      <span />
                    )}
                    <FailureActions d={d} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- page

const money = (n) => (Number.isFinite(n) ? "₹" + Number(n).toLocaleString("en-IN") : "—");

export default function OverviewPage() {
  const { stats, series, attention, recentAstro, recentWishlist, recentMessages, invoices, totals, pricing, store, connections } = useLoaderData();

  const connectionRows = [
    ["Gmail (sends every email)", connections.gmail, "mail"],
    ["WhatsApp (Interakt)", connections.whatsapp, "whatsapp"],
    ["Google Sheets backup (optional)", connections.sheets, "sheets"],
    ["Google Places (Place of Birth)", connections.places, "pin"],
  ];

  return (
    <PageIn>
      <PageHeader title="Overview" description="Today's activity, and every part of this app in one place." />

      <AttentionPanel attention={attention} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px" }}>
        <StatCard icon="users" tint={brand.accentTint} color={brand.accent} label="Recommendation leads today" stat={stats.leadsToday} spark={series.leads} />
        <StatCard icon="heart" tint={brand.dangerBg} color={brand.danger} label="Wishlist syncs today" stat={stats.wishlistToday} />
        <StatCard icon="whatsapp" tint={brand.successBg} color={brand.success} label="WhatsApp sent today" stat={stats.whatsappSentToday} spark={series.whatsapp} />
        <StatCard icon="package" tint={brand.accentTint} color={brand.accent} label="Orders notified today" stat={stats.ordersNotifiedToday} />
        <StatCard icon="return" tint={brand.warnBg} color={brand.warn} label="Refund messages today" stat={stats.returnsRefundsToday} />
        <StatCard icon="receipt" tint={brand.successBg} color={brand.success} label="Invoices sent today" stat={stats.invoicesToday} />
      </div>

      <SectionTitle icon="users">Customers & leads</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "14px" }}>
        <Panel icon="users" color={brand.accent} tint={brand.accentTint} title="Astro Leads" subtitle={`${totals.astro} in total`} to="/app/astro-leads" linkLabel="Open leads">
          {recentAstro.length === 0 ? (
            <Empty>No leads yet. They appear here when someone submits the recommendation form.</Empty>
          ) : (
            recentAstro.map((l, i) => (
              <Row key={l.id} last={i === recentAstro.length - 1}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name || l.email || "Unnamed lead"}
                  </div>
                  <div style={{ fontSize: "11.5px", color: brand.muted }}>
                    {l.lifeStoneGem ? `Life stone: ${l.lifeStoneGem}` : l.calculationOk ? "No stone saved" : "Calculation failed"} · {timeAgo(l.createdAt)}
                  </div>
                </div>
                <span title={`Email: ${l.emailSendStatus || "pending"}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Icon name="mail" size={13} color={brand.faint} />
                  <Dot tone={statusOf(l.emailSendStatus)} />
                </span>
                <span title={`WhatsApp: ${l.whatsappSendStatus || "pending"}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Icon name="whatsapp" size={13} color={brand.faint} />
                  <Dot tone={statusOf(l.whatsappSendStatus)} />
                </span>
              </Row>
            ))
          )}
        </Panel>

        <Panel icon="heart" color={brand.danger} tint={brand.dangerBg} title="Wishlist Leads" subtitle={`${totals.wishlist} in total`} to="/app/wishlist-leads" linkLabel="Open wishlists">
          {recentWishlist.length === 0 ? (
            <Empty>No wishlist activity yet.</Empty>
          ) : (
            recentWishlist.map((l, i) => (
              <Row key={l.id} last={i === recentWishlist.length - 1}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.email || "Unknown customer"}</div>
                  <div style={{ fontSize: "11.5px", color: brand.muted }}>
                    {l.itemCount} saved item{l.itemCount === 1 ? "" : "s"} · {timeAgo(l.createdAt)}
                  </div>
                </div>
                <span title={`Email: ${l.emailSendStatus || "pending"}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Icon name="mail" size={13} color={brand.faint} />
                  <Dot tone={statusOf(l.emailSendStatus)} />
                </span>
                <span title={`WhatsApp: ${l.whatsappSendStatus || "pending"}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Icon name="whatsapp" size={13} color={brand.faint} />
                  <Dot tone={statusOf(l.whatsappSendStatus)} />
                </span>
              </Row>
            ))
          )}
        </Panel>
      </div>

      <SectionTitle icon="whatsapp">Orders & messages</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "14px" }}>
        <Panel icon="whatsapp" color={brand.success} tint={brand.successBg} title="Latest WhatsApp messages" subtitle="Status comes from Interakt" to="/app/whatsapp-events" linkLabel="Message history">
          {recentMessages.length === 0 ? (
            <Empty>No message events yet.</Empty>
          ) : (
            recentMessages.map((m, i) => {
              const tone = statusOf(m.status);
              return (
                <Row key={m.id} last={i === recentMessages.length - 1}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink }}>
                      {m.phoneTail ? `Number ending ${m.phoneTail}` : "Unknown number"}
                    </div>
                    <div
                      title={m.failureReason || ""}
                      style={{ fontSize: "11.5px", color: tone === "bad" ? brand.danger : brand.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {tone === "bad" && m.failureReason ? m.failureReason : String(m.eventType || "").replace(/^message_/, "").replace(/_/g, " ")} · {timeAgo(m.receivedAt)}
                    </div>
                  </div>
                  <Tag tone={tone === "pending" ? "pending" : tone}>{m.status || "unknown"}</Tag>
                </Row>
              );
            })
          )}
        </Panel>

        <Panel icon="receipt" color={brand.success} tint={brand.successBg} title="GST Invoices" subtitle="Sent on request, never automatically" to="/app/invoices" linkLabel="Open invoices">
          <div style={{ display: "flex", gap: "22px", padding: "14px 0 6px" }}>
            <div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: brand.ink, letterSpacing: "-0.02em", lineHeight: 1 }}>{invoices.week}</div>
              <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "6px" }}>sent in the last 7 days</div>
            </div>
            <div style={{ minWidth: 0 }}>
              {invoices.last ? (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink }}>
                    {invoices.last.orderName || "Order"} · {invoices.last.invoiceNumber}
                  </div>
                  <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                    Latest invoice {timeAgo(invoices.last.lastSentAt)}
                    <Tag tone={statusOf(invoices.last.status) === "bad" ? "bad" : "good"}>{statusOf(invoices.last.status) === "bad" ? "failed" : "sent"}</Tag>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "12.5px", color: brand.muted }}>No invoices sent yet.</div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <SectionTitle icon="diamond">Store setup</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px" }}>
        <Panel icon="rupee" color={brand.accent} tint={brand.accentTint} title="Jewelry Pricing" subtitle="Saved rates per gram" to="/app/pricing" linkLabel="Open pricing">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 22px", paddingTop: "6px" }}>
            {[
              ["Silver", pricing.silver],
              ["22K Yellow", pricing["22k-yellow"]],
              ["18K Yellow", pricing["18k-yellow"]],
              ["18K White", pricing["18k-white"]],
              ["14K Yellow", pricing["14k-yellow"]],
              ["14K White", pricing["14k-white"]],
              ["Panchdhatu", pricing.panchdhatu],
              ["Copper", pricing.copper],
            ].map(([label, v]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${brand.divider}`, fontSize: "12.5px" }}>
                <span style={{ color: brand.muted }}>{label}</span>
                <span style={{ fontWeight: 600, color: brand.ink, fontVariantNumeric: "tabular-nums" }}>{money(v)}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: "11.5px", color: brand.muted }}>
            Making charge {money(pricing.makingCharge)} per gram · GST {pricing.taxRate}%
          </p>
        </Panel>

        <Panel icon="diamond" color={brand.accent} tint={brand.accentTint} title="Gemstone details" subtitle="Shown in every recommendation" to="/app/gemstone-details" linkLabel="Edit stones">
          <div style={{ display: "flex", gap: "22px", padding: "16px 0 4px" }}>
            <div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: brand.ink, lineHeight: 1 }}>{store.gemTotal}</div>
              <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "6px" }}>stones</div>
            </div>
            <div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: brand.ink, lineHeight: 1 }}>{store.gemCustomised}</div>
              <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "6px" }}>with your own details</div>
            </div>
          </div>
        </Panel>

        <Panel icon="globe" color={brand.accent} tint={brand.accentTint} title="Currency by country" subtitle="Storefront currency selector" to="/app/currency-countries" linkLabel="Open currencies">
          <div style={{ display: "flex", gap: "22px", padding: "16px 0 4px" }}>
            <div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: brand.ink, lineHeight: 1 }}>{store.countries}</div>
              <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "6px" }}>countries on</div>
            </div>
            <div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: brand.ink, lineHeight: 1 }}>{store.currencies}</div>
              <div style={{ fontSize: "11.5px", color: brand.muted, marginTop: "6px" }}>currencies</div>
            </div>
          </div>
        </Panel>
      </div>

      <SectionTitle icon="gear">System</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "14px" }}>
        <Panel icon="plug" color={brand.muted} tint={brand.panel} title="Connections" subtitle="Whether each service has been set up" to="/app/settings" linkLabel="Open settings">
          {connectionRows.map(([label, ok, icon], i) => (
            <Row key={label} last={i === connectionRows.length - 1}>
              <Icon name={icon} size={16} color={brand.muted} />
              <span style={{ flex: 1, fontSize: "13px", color: brand.ink }}>{label}</span>
              <Tag tone={ok ? "good" : "warn"}>{ok ? "Set up" : "Not set up"}</Tag>
            </Row>
          ))}
          <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: brand.muted }}>
            This only shows what is saved. For a live check that each service really connects, open{" "}
            <Link to="/app/server-health" style={{ color: brand.accent, textDecoration: "none", fontWeight: 600 }}>
              System Health
            </Link>
            .
          </p>
        </Panel>

        <Panel icon="file-text" color={brand.muted} tint={brand.panel} title="Help & guides" subtitle="Where to go for what">
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "6px" }}>
            {[
              ["server", "System Health", "Live check of every connection", "/app/server-health"],
              ["gear", "Settings", "Connections, WhatsApp messages, emails, invoices", "/app/settings"],
              ["file-text", "Documentation", "What every page and setting does, plus FAQ", "/app/documentation"],
            ].map(([icon, label, hint, to], i, arr) => (
              <Link key={to} to={to} style={{ textDecoration: "none" }}>
                <Row last={i === arr.length - 1}>
                  <Icon name={icon} size={16} color={brand.accent} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink }}>{label}</div>
                    <div style={{ fontSize: "11.5px", color: brand.muted }}>{hint}</div>
                  </div>
                  <Icon name="chevron-right" size={13} color={brand.faint} />
                </Row>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </PageIn>
  );
}
