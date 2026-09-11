/**
 * "Server" health-check page — runs a live check of every moving part
 * this app depends on (database, Shopify Admin API + specific scopes,
 * Gmail SMTP, Google Sheets) and a quick scan of recent leads for
 * anything that failed, so problems show up here before a customer
 * reports them. Read-only, safe to open any time — every check is
 * wrapped so one failing check never breaks the page itself.
 */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { withTimeout, checkGmail, checkGoogleSheets, checkInterakt } from "../utils/serviceHealth.server";
import { brand, Icon, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";

async function checkDatabase() {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 5000, "Database");
    const [leadCount, settingsCount] = await Promise.all([
      prisma.astroLead.count(),
      prisma.appSettings.count(),
    ]);
    return { ok: true, detail: `Connected — ${leadCount} leads, ${settingsCount} settings row(s) on record.` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

async function checkShopifyAdmin(admin) {
  try {
    const res = await withTimeout(admin.graphql(`#graphql\nquery { shop { name myshopifyDomain } }`), 8000, "Shopify Admin API");
    const json = await res.json();
    if (json.errors) return { ok: false, detail: "GraphQL errors: " + JSON.stringify(json.errors).slice(0, 200) };
    const shop = json?.data?.shop;
    if (!shop) return { ok: false, detail: "No shop data returned" };
    return { ok: true, detail: `Connected as ${shop.name} (${shop.myshopifyDomain})` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

async function checkScope(admin, label, query) {
  try {
    const res = await withTimeout(admin.graphql(query), 8000, label);
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    if (json.errors) return { ok: false, detail: "GraphQL errors (likely missing scope): " + JSON.stringify(json.errors).slice(0, 200) };
    return { ok: true, detail: "OK" };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

async function checkRecentLeads() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.astroLead.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const issues = [];
  for (const lead of recent) {
    const problems = [];
    if (!lead.calculationOk) problems.push("chart calculation failed: " + (lead.astroError || "unknown"));
    if (lead.shopifySyncStatus && lead.shopifySyncStatus.startsWith("FAILED")) problems.push("Shopify sync failed");
    if (lead.shopifySyncStatus && lead.shopifySyncStatus.startsWith("threw")) problems.push("Shopify sync threw an error");
    if (lead.emailSendStatus && lead.emailSendStatus.startsWith("threw")) problems.push("email send threw an error");
    if (lead.emailSendStatus && lead.emailSendStatus.startsWith("FAILED")) problems.push("email send failed");
    if (lead.whatsappSendStatus && lead.whatsappSendStatus.startsWith("threw")) problems.push("WhatsApp send threw an error");
    if (lead.whatsappSendStatus && lead.whatsappSendStatus.startsWith("FAILED")) problems.push("WhatsApp send failed");
    if (problems.length) {
      issues.push({
        id: lead.id,
        when: lead.createdAt.toISOString(),
        email: lead.email,
        problems,
        shopifySyncStatus: lead.shopifySyncStatus,
        emailSendStatus: lead.emailSendStatus,
        whatsappSendStatus: lead.whatsappSendStatus,
      });
    }
  }

  return {
    totalLast7Days: recent.length,
    issues: issues.slice(0, 20),
  };
}

async function checkRegisteredWebhooks(admin) {
  try {
    const res = await withTimeout(
      admin.graphql(`#graphql
        query RegisteredWebhooks {
          webhookSubscriptions(first: 50) {
            nodes {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint { callbackUrl }
              }
            }
          }
        }`),
      8000,
      "Webhook subscriptions"
    );
    const json = await res.json();
    if (json.errors) return { ok: false, subscriptions: [], error: JSON.stringify(json.errors).slice(0, 300) };
    const nodes = json?.data?.webhookSubscriptions?.nodes || [];
    return {
      ok: true,
      subscriptions: nodes.map((n) => ({ topic: n.topic, url: n.endpoint?.callbackUrl || "(non-HTTP endpoint)" })),
    };
  } catch (err) {
    return { ok: false, subscriptions: [], error: String(err?.message || err) };
  }
}

async function checkOrderProcessingNotifications() {
  const recent = await prisma.orderProcessingNotification.findMany({
    orderBy: { notifiedAt: "desc" },
    take: 20,
  });
  return recent.map((n) => ({
    ...n,
    notifiedAt: n.notifiedAt.toISOString(),
  }));
}

async function checkOrderProcessingEmailNotifications() {
  const recent = await prisma.orderProcessingEmailNotification.findMany({
    orderBy: { notifiedAt: "desc" },
    take: 20,
  });
  return recent.map((n) => ({
    ...n,
    notifiedAt: n.notifiedAt.toISOString(),
  }));
}

async function checkWebhookReceipts() {
  const recent = await prisma.webhookReceiptLog.findMany({
    orderBy: { receivedAt: "desc" },
    take: 20,
  });
  return recent.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() }));
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);

  const [database, shopifyAdmin, readThemes, readProducts, gmail, googleSheets, interakt, recentLeads, orderProcessingNotifications, orderProcessingEmailNotifications, registeredWebhooks, webhookReceipts] = await Promise.all([
    checkDatabase(),
    checkShopifyAdmin(admin),
    checkScope(
      admin,
      "read_themes",
      `#graphql\nquery { themes(first: 1, roles: [MAIN]) { nodes { id name } } }`
    ),
    checkScope(
      admin,
      "read_products",
      `#graphql\nquery { collectionByHandle(handle: "ruby") { id title } }`
    ),
    checkGmail(settings),
    checkGoogleSheets(settings),
    checkInterakt(settings),
    checkRecentLeads(),
    checkOrderProcessingNotifications(),
    checkOrderProcessingEmailNotifications(),
    checkRegisteredWebhooks(admin),
    checkWebhookReceipts(),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    checks: [
      { name: "Database (Postgres)", ...database },
      { name: "Shopify Admin API", ...shopifyAdmin },
      { name: "Scope: read_themes (for email logo/social links)", ...readThemes },
      { name: "Scope: read_products (for collection images)", ...readProducts },
      { name: "Gmail SMTP (email sending)", ...gmail },
      { name: "Google Sheets mirror (optional)", ...googleSheets },
      { name: "Interakt (WhatsApp sending)", ...interakt },
    ],
    recentLeads,
    orderProcessingNotifications,
    orderProcessingEmailNotifications,
    registeredWebhooks,
    webhookReceipts,
  };
};

// Same 4-state model/colors as the Settings page's own StatusBadge, so a
// "Connected"/"Failing" pill means the same thing and looks the same
// everywhere in this app.
const STATUS_STYLE = {
  true: { bg: brand.successBg, border: brand.successLine, color: brand.success, icon: "check-circle", label: "OK" },
  false: { bg: brand.dangerBg, border: brand.dangerLine, color: brand.danger, icon: "x-circle", label: "FAILING" },
  warn: { bg: brand.warnBg, border: brand.warnLine, color: brand.warn, icon: "alert-triangle", label: "WARNING" },
  none: { bg: brand.panel, border: brand.border, color: brand.muted, icon: null, label: "Not configured" },
};

function StatusPill({ ok, title }) {
  const key = ok === true ? "true" : ok === false ? "false" : ok === "warn" ? "warn" : "none";
  const s = STATUS_STYLE[key];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "12px",
        fontWeight: 600,
        padding: "4px 11px",
        borderRadius: "999px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      {s.icon && <Icon name={s.icon} size={12} color={s.color} />}
      {s.label}
    </span>
  );
}

function ResultPill({ status }) {
  if (!status) return <span style={{ color: brand.faint }}>—</span>;
  const ok = status.startsWith("OK") ? true : status.startsWith("threw") || status.startsWith("FAILED") ? false : "warn";
  return <StatusPill ok={ok} title={status} />;
}

function Explain({ summary, children, defaultOpen }) {
  return (
    <details open={defaultOpen || undefined} style={{ marginBottom: "12px" }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 500, color: brand.muted, userSelect: "none" }}>
        <Icon name="info" size={13} color={brand.muted} style={{ flexShrink: 0 }} />
        {summary}
      </summary>
      <div style={{ marginTop: "8px", fontSize: "13px", color: brand.body, lineHeight: 1.6 }}>{children}</div>
    </details>
  );
}

const monoDetailStyle = { color: brand.body, fontFamily: brand.mono, fontSize: "11px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "480px" };

function SectionTitle({ children }) {
  return <h2 style={{ fontSize: "15px", fontWeight: 700, color: brand.ink, margin: "28px 0 12px" }}>{children}</h2>;
}

export default function ServerHealthPage() {
  const { checkedAt, checks, recentLeads, orderProcessingNotifications, orderProcessingEmailNotifications, registeredWebhooks, webhookReceipts } = useLoaderData();
  const failingCount = checks.filter((c) => c.ok === false).length;

  return (
    <PageIn>
      <PageHeader title="System health" description="A live check of every service this app depends on." />

      <Card padding="0" style={{ marginBottom: "18px", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", background: failingCount === 0 ? brand.successBg : brand.dangerBg, borderBottom: `1px solid ${failingCount === 0 ? brand.successLine : brand.dangerLine}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <Icon name={failingCount === 0 ? "check-circle" : "alert"} size={17} color={failingCount === 0 ? brand.success : brand.danger} />
            <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: failingCount === 0 ? brand.success : brand.danger }}>
              {failingCount === 0 ? "All checks passing" : `${failingCount} check(s) failing`}
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>Reload the page to re-run every check. Last checked: {new Date(checkedAt).toLocaleString()}.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "16px 22px" }}>
          {checks.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 12px", background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 500, color: brand.body }}>{c.name.split("(")[0].split(":")[0].trim()}</span>
              <StatusPill ok={c.ok} title={c.detail} />
            </div>
          ))}
        </div>
      </Card>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Check</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td style={{ ...tdStyle, fontWeight: 600, color: brand.ink }}>{c.name}</td>
                <td style={tdStyle}>
                  <StatusPill ok={c.ok} />
                </td>
                <td style={{ ...tdStyle, ...(c.ok === false ? monoDetailStyle : { color: brand.muted, fontSize: "12.5px" }) }}>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>Recent lead issues (last 7 days — {recentLeads.totalLast7Days} lead(s) total)</SectionTitle>
      {recentLeads.issues.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No issues found among leads from the last 7 days.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Problems</th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.issues.map((issue) => (
                <tr key={issue.id}>
                  <td style={tdStyle}>{new Date(issue.when).toLocaleString()}</td>
                  <td style={tdStyle}>{issue.email || "—"}</td>
                  <td style={{ ...tdStyle, color: brand.danger }}>
                    {issue.problems.map((p, i) => (
                      <div key={i}>• {p}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Webhook receipts (definitive)</SectionTitle>
      <Explain summary="What this table is, and why it's the most trustworthy one on this page">
        Every real hit this server has received on <code>/webhooks/orders/updated</code> — logged unconditionally,
        before anything else runs. Unlike the other checks below, an empty list here can only mean one thing:
        Shopify never actually called this endpoint. If it's empty even after a real order was marked "as in
        progress," the subscription itself isn't taking effect — worth a fresh <code>shopify app deploy</code> or
        checking the Partner Dashboard directly.
      </Explain>
      {webhookReceipts.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No webhook calls received yet.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Topic</th>
                <th style={thStyle}>Order ID</th>
                <th style={thStyle}>What happened</th>
              </tr>
            </thead>
            <tbody>
              {webhookReceipts.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{new Date(r.receivedAt).toLocaleString()}</td>
                  <td style={tdStyle}>{r.topic}</td>
                  <td style={tdStyle}>{r.orderId || "—"}</td>
                  <td style={{ ...tdStyle, whiteSpace: "normal", ...monoDetailStyle }}>{r.detail || "(processing never completed — check Render logs)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Registered webhooks</SectionTitle>
      <Explain summary="Why this one is unreliable for managed/TOML webhooks — see receipts above instead">
        Queries Shopify's classic <code>webhookSubscriptions</code> API — turns out this does NOT reflect
        TOML-declared "managed" webhooks (confirmed: it showed zero even for <code>orders/create</code>, which
        demonstrably works today). Kept for reference, but the "Webhook receipts" section above is the actual
        reliable answer.
      </Explain>
      {!registeredWebhooks.ok ? (
        <p style={{ fontSize: "13px", color: brand.body }}>Failed to check: {registeredWebhooks.error}</p>
      ) : registeredWebhooks.subscriptions.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No webhooks registered at all — unexpected, worth investigating.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Topic</th>
                <th style={thStyle}>Callback URL</th>
              </tr>
            </thead>
            <tbody>
              {registeredWebhooks.subscriptions.map((s, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{s.topic}</td>
                  <td style={{ ...tdStyle, fontFamily: brand.mono, fontSize: "11px" }}>{s.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Order Processing WhatsApp notifications</SectionTitle>
      <Explain summary="What counts as a row here, and what an empty list means">
        One row per order the webhook found IN_PROGRESS and attempted to notify — see{" "}
        <code>webhooks.orders.updated.jsx</code>. An EMPTY list here, after you've actually marked a real order "as
        in progress," is itself the diagnostic: it means the webhook either never fired from Shopify at all, or
        fired but never found an IN_PROGRESS fulfillment order for that order.
      </Explain>
      {orderProcessingNotifications.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No order-processing notifications recorded yet.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Order</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {orderProcessingNotifications.map((n) => (
                <tr key={n.id}>
                  <td style={tdStyle}>{new Date(n.notifiedAt).toLocaleString()}</td>
                  <td style={tdStyle}>{n.orderName || n.orderId}</td>
                  <td style={tdStyle}>{n.phone || "—"}</td>
                  <td style={tdStyle}>
                    <ResultPill status={n.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Order Processing Email notifications</SectionTitle>
      <Explain summary="Why this exists, and what an empty list means">
        Shopify has no native "order processing/approved" email template to hook into (only Order
        confirmation/Shipping confirmation/Delivered/Cancelled), so this app sends it directly instead — same
        trigger as the WhatsApp table above, via the merchant's connected Gmail (Settings page). One row per order
        the webhook attempted to email — see <code>orderProcessingEmail.server.js</code>. A "skipped" result
        usually means Gmail isn't configured yet, or the order had no email address.
      </Explain>
      {orderProcessingEmailNotifications.length === 0 ? (
        <p style={{ fontSize: "13px", color: brand.muted }}>No order-processing emails recorded yet.</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Order</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {orderProcessingEmailNotifications.map((n) => (
                <tr key={n.id}>
                  <td style={tdStyle}>{new Date(n.notifiedAt).toLocaleString()}</td>
                  <td style={tdStyle}>{n.orderName || n.orderId}</td>
                  <td style={tdStyle}>{n.email || "—"}</td>
                  <td style={tdStyle}>
                    <ResultPill status={n.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>What each check means</SectionTitle>
      <Card>
        <Explain summary="read_themes / read_products">
          If either fails, the recommendation email still sends but falls back to a plain text header (no store
          logo/social links) or a gray box instead of a real collection image.
        </Explain>
        <Explain summary="Google Sheets">
          "Not configured" is expected and harmless if you're not using the Sheet mirror — leads/events still save
          to the database regardless.
        </Explain>
        <Explain summary="Interakt">
          This only confirms the Secret Key itself is valid — it can't confirm the WhatsApp template is
          Meta-approved (green dot in Interakt's Templates Library), since that's not something the API exposes a
          check for. Use the Settings page's "Send Test" button to confirm the full send path.
        </Explain>
      </Card>
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
