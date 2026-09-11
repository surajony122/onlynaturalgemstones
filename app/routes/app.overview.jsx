/**
 * At-a-glance home dashboard for the lead/WhatsApp/order-notification
 * side of this app (Astro Leads, Wishlist Leads, WhatsApp Events, Order
 * Processing, Settings, Server) — added because that functionality grew
 * into 6+ separate pages over one long build session with no single
 * place that answers "is everything OK right now" at a glance. Doesn't
 * touch the existing "/app" (jewelry variant pricing) page or nav entry
 * — that's a distinct, pre-existing feature, not part of this.
 *
 * "Today"/"yesterday" below mean since local midnight on the SERVER's
 * clock (this app doesn't do per-shop timezone conversion anywhere else
 * either, so this stays consistent with that rather than introducing a
 * new timezone concept just for this page).
 */
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAttentionSummary } from "../utils/attention.server";
import { brand, Icon, Card, PageHeader, PageIn } from "../components/table-kit";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  const [leadsToday, leadsYesterday, wishlistToday, wishlistYesterday, whatsappToday, whatsappYesterday, ordersToday, ordersYesterday] =
    await Promise.all([
      prisma.astroLead.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.astroLead.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.wishlistLead.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.wishlistLead.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.whatsAppMessageEvent.count({ where: { receivedAt: { gte: todayStart }, eventType: "message_api_sent" } }),
      prisma.whatsAppMessageEvent.count({ where: { receivedAt: { gte: yesterdayStart, lt: todayStart }, eventType: "message_api_sent" } }),
      prisma.orderProcessingNotification.count({ where: { notifiedAt: { gte: todayStart } } }),
      prisma.orderProcessingNotification.count({ where: { notifiedAt: { gte: yesterdayStart, lt: todayStart } } }),
    ]);

  const attention = await getAttentionSummary();

  return {
    stats: {
      leadsToday: { value: leadsToday, delta: leadsToday - leadsYesterday },
      wishlistToday: { value: wishlistToday, delta: wishlistToday - wishlistYesterday },
      whatsappSentToday: { value: whatsappToday, delta: whatsappToday - whatsappYesterday },
      ordersNotifiedToday: { value: ordersToday, delta: ordersToday - ordersYesterday },
    },
    attention,
  };
};

function deltaLabel(delta) {
  if (delta > 0) return { label: `+${delta} vs yesterday`, color: brand.success };
  if (delta < 0) return { label: `${delta} vs yesterday`, color: brand.danger };
  return { label: "steady", color: brand.muted };
}

function StatCard({ label, stat }) {
  const d = deltaLabel(stat.delta);
  return (
    <Card>
      <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 10px" }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: "9px" }}>
        <span style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", color: brand.ink, lineHeight: 1 }}>{stat.value}</span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: d.color }}>{d.label}</span>
      </div>
    </Card>
  );
}

function AttentionPanel({ attention }) {
  if (attention.healthy) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: "13px 20px",
          background: brand.successBg,
          border: `1px solid ${brand.successLine}`,
          borderRadius: "14px",
          marginBottom: "24px",
        }}
      >
        <Icon name="check-circle" size={15} color={brand.success} />
        <span style={{ fontSize: "13.5px", fontWeight: 700, color: brand.success }}>All clear</span>
        <span style={{ fontSize: "12.5px", color: brand.muted }}>No recent lead or order-notification failures in the last 7 days.</span>
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: `1px solid ${brand.dangerLine}`, borderRadius: "14px", boxShadow: brand.shadow, overflow: "hidden", marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "13px 20px", background: brand.dangerBg, borderBottom: `1px solid ${brand.dangerLine}` }}>
        <Icon name="alert-triangle" size={15} color={brand.danger} />
        <span style={{ fontSize: "13.5px", fontWeight: 700, color: brand.danger }}>Needs attention</span>
        <span style={{ fontSize: "12.5px", color: brand.muted }}>
          {attention.items.length} thing{attention.items.length === 1 ? "" : "s"} to look at
        </span>
      </div>
      {attention.items.map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 20px", borderBottom: `1px solid ${brand.divider}` }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: a.severity === "warn" ? brand.warn : brand.danger, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13.5px", fontWeight: 600, color: brand.ink, marginBottom: "2px" }}>{a.title}</div>
            {a.detail && <div style={{ fontSize: "12.5px", color: brand.muted }}>{a.detail}</div>}
          </div>
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
      ))}
    </div>
  );
}

function SectionCard({ icon, iconColor, title, description, links }) {
  return (
    <Card hover>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px" }}>
        <Icon name={icon} size={16} color={iconColor} />
        <span style={{ fontWeight: 600, fontSize: "14px", color: brand.ink }}>{title}</span>
      </div>
      <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 12px", lineHeight: 1.55 }}>{description}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {links.map((l) => (
          <Link key={l.href} to={l.href} style={{ fontSize: "12.5px", fontWeight: 500, color: brand.accent, textDecoration: "none" }}>
            {l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  const { stats, attention } = useLoaderData();

  return (
    <PageIn>
      <PageHeader title="Overview" description="Today's activity, and every part of this app in one place." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px", marginBottom: "16px" }}>
        <StatCard label="Leads today" stat={stats.leadsToday} />
        <StatCard label="Wishlist syncs today" stat={stats.wishlistToday} />
        <StatCard label="WhatsApp sent today" stat={stats.whatsappSentToday} />
        <StatCard label="Orders notified today" stat={stats.ordersNotifiedToday} />
      </div>

      <AttentionPanel attention={attention} />

      <h2 style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: brand.faint, margin: "0 0 12px" }}>
        Everything else
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "14px" }}>
        <SectionCard
          icon="tag"
          iconColor={brand.accent}
          title="Jewelry Pricing"
          description="Daily metal rates and the customisation variants they price."
          links={[{ href: "/app", label: "Open pricing" }]}
        />
        <SectionCard
          icon="users"
          iconColor={brand.accent}
          title="Leads"
          description="Everyone who filled the gem recommendation form or saved a wishlist item."
          links={[
            { href: "/app/astro-leads", label: "Gem recommendation leads" },
            { href: "/app/wishlist-leads", label: "Wishlist leads" },
          ]}
        />
        <SectionCard
          icon="message"
          iconColor={brand.success}
          title="Messages & Orders"
          description="Every message sent, whether it was delivered or read, and order notification history."
          links={[{ href: "/app/whatsapp-events", label: "Message history" }]}
        />
        <SectionCard
          icon="gear"
          iconColor={brand.muted}
          title="Settings"
          description="Email, WhatsApp templates, Google Sheets, order trigger tag."
          links={[{ href: "/app/settings", label: "Open settings" }]}
        />
        <SectionCard
          icon="server"
          iconColor={brand.danger}
          title="System health"
          description="Checks every connection this app depends on."
          links={[{ href: "/app/server-health", label: "View diagnostics" }]}
        />
      </div>
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
