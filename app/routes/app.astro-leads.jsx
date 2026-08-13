/**
 * Astro Advice leads + email tracking viewer. Read-only — shows the
 * AstroLead rows (most recent first) with a rolled-up email status
 * (sent / opened count / clicked count) per lead, sourced from
 * EmailEvent rows matched by trackingId.
 */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 100;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const leads = await prisma.astroLead.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
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
    // detail is "<label> -> <url>" for click events (see track.$type.jsx)
    // — pull just the label out for a compact per-lead list of which
    // specific links were clicked.
    if (ev.event === "clicked" && ev.detail) {
      const label = ev.detail.includes(" -> ") ? ev.detail.split(" -> ")[0] : ev.detail;
      eventsByTrackingId[ev.trackingId].clickedLinks.push(label);
    }
  }

  return {
    leads: leads.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      emailStatus: eventsByTrackingId[l.trackingId] || { sent: 0, opened: 0, clicked: 0, clickedLinks: [] },
    })),
  };
};

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", whiteSpace: "nowrap" };

function statusPill(label, active, color) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        marginRight: "4px",
        borderRadius: "10px",
        fontSize: "11px",
        fontWeight: 600,
        background: active ? color + "22" : "#f1f2f3",
        color: active ? color : "#8c9196",
      }}
    >
      {label}
    </span>
  );
}

export default function AstroLeadsPage() {
  const { leads } = useLoaderData();

  return (
    <s-page heading={`Astro Advice — Leads (${leads.length})`} width="full">
      {/* Compact single-line info bar instead of the two sidebar boxes —
          keeps the aside column from splitting the width, and this is a
          quick reference note, not something that needs its own section. */}
      <s-section>
        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6d7175" }}>
          Most recent {PAGE_SIZE} leads · "Opened" is best-effort (some mail clients pre-fetch/block tracking
          images) · "Clicked" is reliable and shows which link on hover · No real "delivered" signal exists · Flow's
          own run history isn't readable via API —{" "}
          <a
            href="https://admin.shopify.com/store/0f9yd0-jr/apps/flow"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2c6ecb" }}
          >
            open Shopify Flow directly
          </a>
          .
        </p>

        {leads.length === 0 ? (
          <s-paragraph>No leads yet.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Life Stone</th>
                  <th style={th}>Calculation</th>
                  <th style={th}>Shopify Sync</th>
                  <th style={th}>Email</th>
                  <th style={th}>Clicked Links</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td style={td}>{new Date(lead.createdAt).toLocaleString()}</td>
                    <td style={td}>{lead.name || "—"}</td>
                    <td style={td}>{lead.email || "—"}</td>
                    <td style={td}>{lead.phone || "—"}</td>
                    <td style={td}>{lead.lifeStoneGem || "—"}</td>
                    <td style={td}>
                      {lead.calculationOk
                        ? statusPill("OK", true, "#008060")
                        : statusPill("Failed", true, "#d82c0d")}
                    </td>
                    <td style={td} title={lead.shopifySyncStatus || ""}>
                      {(lead.shopifySyncStatus || "").startsWith("OK")
                        ? statusPill("Synced", true, "#008060")
                        : lead.shopifySyncStatus
                          ? statusPill("Failed", true, "#d82c0d")
                          : statusPill("—", false, "#8c9196")}
                    </td>
                    <td style={td}>
                      {statusPill("Sent", lead.emailStatus.sent > 0, "#008060")}
                      {statusPill(
                        "Opened" + (lead.emailStatus.opened > 1 ? ` ×${lead.emailStatus.opened}` : ""),
                        lead.emailStatus.opened > 0,
                        "#6b5ce0"
                      )}
                      {statusPill(
                        "Clicked" + (lead.emailStatus.clicked > 1 ? ` ×${lead.emailStatus.clicked}` : ""),
                        lead.emailStatus.clicked > 0,
                        "#2c6ecb"
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "normal", minWidth: "180px" }}>
                      {lead.emailStatus.clickedLinks?.length
                        ? lead.emailStatus.clickedLinks.map((link, i) => (
                            <span
                              key={i}
                              style={{
                                display: "inline-block",
                                fontSize: "11px",
                                color: "#2c6ecb",
                                background: "#eaf1fa",
                                padding: "2px 7px",
                                borderRadius: "8px",
                                margin: "1px 3px 1px 0",
                              }}
                            >
                              {link}
                            </span>
                          ))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
