/**
 * At-a-glance home dashboard for the lead/WhatsApp/order-notification
 * side of this app (Astro Leads, Wishlist Leads, WhatsApp Events, Order
 * Processing, Settings, Server) — added because that functionality grew
 * into 6+ separate pages over one long build session with no single
 * place that answers "is everything OK right now" at a glance. Doesn't
 * touch the existing "/app" (jewelry variant pricing) page or nav entry
 * — that's a distinct, pre-existing feature, not part of this.
 *
 * "Today" below means since local midnight on the SERVER's clock (this
 * app doesn't do per-shop timezone conversion anywhere else either, so
 * this stays consistent with that rather than introducing a new
 * timezone concept just for this page).
 */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { brand } from "../components/table-kit";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [leadsToday, wishlistToday, whatsappSentToday, ordersNotifiedToday, dbOk] = await Promise.all([
    prisma.astroLead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.wishlistLead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.whatsAppMessageEvent.count({ where: { receivedAt: { gte: todayStart }, eventType: "message_api_sent" } }),
    prisma.orderProcessingNotification.count({ where: { notifiedAt: { gte: todayStart } } }),
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  ]);

  // Lightweight health signal for the top badge — full diagnostics live
  // on the Server page; this just decides green vs red. A lead from the
  // last 24h with a real failure (not "skipped", a genuine error) or an
  // unreachable database both count as "something needs attention".
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentLeads = await prisma.astroLead.findMany({
    where: { createdAt: { gte: since24h } },
    select: { calculationOk: true, shopifySyncStatus: true, emailSendStatus: true, whatsappSendStatus: true },
  });
  const hasRecentFailure = recentLeads.some(
    (l) =>
      !l.calculationOk ||
      l.shopifySyncStatus?.startsWith("FAILED") ||
      l.emailSendStatus?.startsWith("FAILED") ||
      l.whatsappSendStatus?.startsWith("FAILED")
  );
  const healthy = dbOk && !hasRecentFailure;

  return {
    stats: { leadsToday, wishlistToday, whatsappSentToday, ordersNotifiedToday },
    healthy,
  };
};

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${brand.border}`, borderRadius: "12px", boxShadow: brand.shadow, padding: "16px 18px" }}>
      <p style={{ fontSize: "12px", color: brand.body, margin: "0 0 8px" }}>{label}</p>
      <p style={{ fontSize: "22px", fontWeight: 500, letterSpacing: "-0.02em", margin: 0, color: brand.heading }}>{value}</p>
    </div>
  );
}

function SectionCard({ icon, iconColor, title, description, links }) {
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${brand.border}`, borderRadius: "12px", boxShadow: brand.shadow, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontSize: "16px", color: iconColor, lineHeight: 1 }}>{icon}</span>
        <p style={{ fontWeight: 500, fontSize: "14px", margin: 0, color: brand.heading }}>{title}</p>
      </div>
      <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 12px", lineHeight: 1.5 }}>{description}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {links.map((l) => (
          <a key={l.href} href={l.href} style={{ fontSize: "12.5px", fontWeight: 500, color: brand.accent, textDecoration: "none" }}>
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { stats, healthy } = useLoaderData();

  return (
    <s-page heading="Overview" width="full">
      <s-section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <p style={{ fontSize: "12.5px", color: brand.muted, margin: 0 }}>
            Today's activity, and every part of this app in one place.
          </p>
          <a
            href="/app/server-health"
            style={{
              fontSize: "11.5px",
              fontWeight: 500,
              textDecoration: "none",
              padding: "5px 12px",
              borderRadius: "20px",
              color: healthy ? brand.success : brand.danger,
              background: healthy ? "#E9F7EF" : "#FEF2F2",
            }}
          >
            {healthy ? "All systems OK" : "Needs attention — view details"}
          </a>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
          <StatCard label="Leads today" value={stats.leadsToday} />
          <StatCard label="Wishlist syncs today" value={stats.wishlistToday} />
          <StatCard label="WhatsApp sent today" value={stats.whatsappSentToday} />
          <StatCard label="Orders notified today" value={stats.ordersNotifiedToday} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
          <SectionCard
            icon="👥"
            iconColor={brand.accent}
            title="Leads"
            description="Everyone who filled the gem recommendation form or saved a wishlist item."
            links={[
              { href: "/app/astro-leads", label: "Gem recommendation leads" },
              { href: "/app/wishlist-leads", label: "Wishlist leads" },
            ]}
          />
          <SectionCard
            icon="💬"
            iconColor={brand.success}
            title="WhatsApp"
            description="Every message sent, and whether it was delivered or read."
            links={[{ href: "/app/whatsapp-events", label: "Message history" }]}
          />
          <SectionCard
            icon="📦"
            iconColor="#B45309"
            title="Orders"
            description="Orders tagged to trigger a processing notification."
            links={[{ href: "/app/server-health", label: "Order notifications (on Server page)" }]}
          />
          <SectionCard
            icon="⚙️"
            iconColor={brand.muted}
            title="Settings"
            description="Email, WhatsApp templates, Google Sheets, order trigger tag."
            links={[{ href: "/app/settings", label: "Open settings" }]}
          />
          <SectionCard
            icon="🩺"
            iconColor={brand.danger}
            title="System health"
            description="Checks every connection this app depends on."
            links={[{ href: "/app/server-health", label: "View diagnostics" }]}
          />
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
