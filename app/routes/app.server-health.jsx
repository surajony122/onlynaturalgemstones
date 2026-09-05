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

const STORE_DOMAIN = "onlynaturalgemstones.com";

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

// One row per order the "order processing" WhatsApp notification either
// sent for, or attempted and failed for — see
// webhooks.orders.updated.jsx. An EMPTY list here (after you've actually
// marked a real order "as in progress") is itself the diagnostic: it
// means the webhook never even reached the point of finding an
// IN_PROGRESS fulfillment order for that order — check Render's logs for
// "[webhooks.orders.updated]" lines to see exactly where it stopped.
/** Lists what Shopify actually has registered for this app right now —
 * settles "is the webhook really subscribed" definitively instead of
 * guessing from shopify.app.toml (a TOML declaration only takes effect
 * once `shopify app deploy` releases it, and even then it's worth
 * confirming directly rather than assuming). */
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

// Email counterpart to the above -- see orderProcessingEmail.server.js
// and webhooks.orders.updated.jsx's "Channel 2: Email" section. Kept as
// its own table (not merged into the one above) since the two channels
// dedup, succeed, and fail independently of each other.
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

/** The definitive answer to "does Shopify actually call our webhook
 * endpoint" — written unconditionally, before anything else runs, at the
 * top of webhooks.orders.updated.jsx. Unlike checkRegisteredWebhooks
 * (which queries an API that may not reflect TOML-declared "managed"
 * webhooks at all) or checkOrderProcessingNotifications (silent for
 * "fired but found nothing to do"), an empty list here can only mean one
 * thing: the webhook never reached this server. */
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
  true: { bg: "#ECFDF5", border: "#A7F3D0", color: "#16A34A", label: "✓ OK" },
  false: { bg: "#FEF2F2", border: "#FECACA", color: "#DC2626", label: "✕ FAILING" },
  warn: { bg: "#FFFBEB", border: "#FDE68A", color: "#B45309", label: "⚠ WARNING" },
  none: { bg: "#F9FAFB", border: "#E5E7EB", color: "#6B7280", label: "○ Not configured" },
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
        fontSize: "11.5px",
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "999px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// Plain-text OK/threw/FAILED status strings (from send results, sync
// statuses, etc.) mapped to the same pill look — anything starting "OK"
// reads as success, "threw"/"FAILED" as failure, everything else as
// neutral (e.g. a raw diagnostic string that isn't a pass/fail verdict).
function ResultPill({ status }) {
  if (!status) return <span style={{ color: "#9CA3AF" }}>—</span>;
  const ok = status.startsWith("OK") ? true : status.startsWith("threw") || status.startsWith("FAILED") ? false : "warn";
  return <StatusPill ok={ok} title={status} />;
}

// Same collapsible pattern as the Settings page's Explain — long
// context text hides behind a toggle so the table itself is the first
// thing you see, not a wall of paragraphs above it.
function Explain({ summary, children, defaultOpen }) {
  return (
    <details open={defaultOpen || undefined} style={{ marginBottom: "12px" }}>
      <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 500, color: "#6B7280", userSelect: "none" }}>
        {summary}
      </summary>
      <div style={{ marginTop: "8px" }}>{children}</div>
    </details>
  );
}

const th = { textAlign: "left", padding: "9px 12px", fontSize: "11.5px", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid #E5E7EB", background: "#FAFAFA" };
const td = { padding: "10px 12px", fontSize: "13px", borderBottom: "1px solid #EDEEF1", verticalAlign: "top" };
const tableWrapStyle = { border: "1px solid #E5E7EB", borderRadius: "10px", overflow: "hidden", overflowX: "auto" };
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const monoDetailStyle = { color: "#374151", fontFamily: "monospace", fontSize: "11px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "480px" };

export default function ServerHealthPage() {
  const { checkedAt, checks, recentLeads, orderProcessingNotifications, orderProcessingEmailNotifications, registeredWebhooks, webhookReceipts } = useLoaderData();
  const failingCount = checks.filter((c) => c.ok === false).length;

  return (
    <s-page heading="Server" inlineSize="large">
      <s-section heading={failingCount === 0 ? "✓ All checks passing" : `⚠ ${failingCount} check(s) failing`}>
        {/* At-a-glance strip — every check's pill in one row, so the
            overall picture reads in a glance before scrolling into the
            detail table below (same idea as Settings' "Connections at a
            glance"). */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", margin: "4px 0 14px" }}>
          {checks.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", background: "#F9FAFB", border: "1px solid #EDEEF1", borderRadius: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 500, color: "#374151" }}>{c.name.split("(")[0].split(":")[0].trim()}</span>
              <StatusPill ok={c.ok} title={c.detail} />
            </div>
          ))}
        </div>

        <p style={{ fontSize: "12px", color: "#9CA3AF", margin: "0 0 12px" }}>
          Reload the page to re-run every check. Last checked: {new Date(checkedAt).toLocaleString()}.
        </p>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Check</th>
                <th style={th}>Status</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.name}>
                  <td style={{ ...td, fontWeight: 500, color: "#111827" }}>{c.name}</td>
                  <td style={td}>
                    <StatusPill ok={c.ok} />
                  </td>
                  <td style={{ ...td, ...(c.ok === false ? monoDetailStyle : { color: "#6B7280", fontSize: "12.5px" }) }}>
                    {c.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>

      <s-section heading={`Recent lead issues (last 7 days — ${recentLeads.totalLast7Days} lead(s) total)`}>
        {recentLeads.issues.length === 0 ? (
          <s-paragraph>✓ No issues found among leads from the last 7 days.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Email</th>
                  <th style={th}>Problems</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.issues.map((issue) => (
                  <tr key={issue.id}>
                    <td style={td}>{new Date(issue.when).toLocaleString()}</td>
                    <td style={td}>{issue.email || "—"}</td>
                    <td style={{ ...td, color: "#DC2626" }}>
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
      </s-section>

      <s-section heading="Webhook receipts (definitive)">
        <Explain summary="ℹ️ What this table is, and why it's the most trustworthy one on this page">
          <s-paragraph>
            Every real hit this server has received on <s-text>/webhooks/orders/updated</s-text> — logged
            unconditionally, before anything else runs. Unlike the other checks below, an empty list here can only
            mean one thing: Shopify never actually called this endpoint. If it's empty even after a real order was
            marked "as in progress," the subscription itself isn't taking effect — worth a fresh{" "}
            <s-text>shopify app deploy</s-text> or checking the Partner Dashboard directly.
          </s-paragraph>
        </Explain>
        {webhookReceipts.length === 0 ? (
          <s-paragraph>No webhook calls received yet.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Topic</th>
                  <th style={th}>Order ID</th>
                  <th style={th}>What happened</th>
                </tr>
              </thead>
              <tbody>
                {webhookReceipts.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.receivedAt).toLocaleString()}</td>
                    <td style={td}>{r.topic}</td>
                    <td style={td}>{r.orderId || "—"}</td>
                    <td style={{ ...td, whiteSpace: "normal", ...monoDetailStyle }}>
                      {r.detail || "(processing never completed — check Render logs)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Registered webhooks">
        <Explain summary="ℹ️ Why this one is unreliable for managed/TOML webhooks — see receipts above instead">
          <s-paragraph>
            Queries Shopify's classic <s-text>webhookSubscriptions</s-text> API — turns out this does NOT reflect
            TOML-declared "managed" webhooks (confirmed: it showed zero even for <s-text>orders/create</s-text>,
            which demonstrably works today). Kept for reference, but the "Webhook receipts" section above is the
            actual reliable answer.
          </s-paragraph>
        </Explain>
        {!registeredWebhooks.ok ? (
          <s-paragraph>
            <s-text>Failed to check: {registeredWebhooks.error}</s-text>
          </s-paragraph>
        ) : registeredWebhooks.subscriptions.length === 0 ? (
          <s-paragraph>No webhooks registered at all — unexpected, worth investigating.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>Topic</th>
                  <th style={th}>Callback URL</th>
                </tr>
              </thead>
              <tbody>
                {registeredWebhooks.subscriptions.map((s, i) => (
                  <tr key={i}>
                    <td style={td}>{s.topic}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: "11px" }}>{s.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Order Processing WhatsApp notifications">
        <Explain summary="ℹ️ What counts as a row here, and what an empty list means">
          <s-paragraph>
            One row per order the webhook found IN_PROGRESS and attempted to notify — see{" "}
            <s-text>webhooks.orders.updated.jsx</s-text>. An EMPTY list here, after you've actually marked a real
            order "as in progress," is itself the diagnostic: it means the webhook either never fired from Shopify
            at all, or fired but never found an IN_PROGRESS fulfillment order for that order.
          </s-paragraph>
        </Explain>
        {orderProcessingNotifications.length === 0 ? (
          <s-paragraph>No order-processing notifications recorded yet.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Order</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {orderProcessingNotifications.map((n) => (
                  <tr key={n.id}>
                    <td style={td}>{new Date(n.notifiedAt).toLocaleString()}</td>
                    <td style={td}>{n.orderName || n.orderId}</td>
                    <td style={td}>{n.phone || "—"}</td>
                    <td style={td}>
                      <ResultPill status={n.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Order Processing Email notifications">
        <Explain summary="ℹ️ Why this exists, and what an empty list means">
          <s-paragraph>
            Shopify has no native "order processing/approved" email template to hook into (only Order
            confirmation/Shipping confirmation/Delivered/Cancelled), so this app sends it directly instead — same
            trigger as the WhatsApp table above, via the merchant's connected Gmail (Settings page). One row per
            order the webhook attempted to email — see <s-text>orderProcessingEmail.server.js</s-text>. A "skipped"
            result usually means Gmail isn't configured yet, or the order had no email address.
          </s-paragraph>
        </Explain>
        {orderProcessingEmailNotifications.length === 0 ? (
          <s-paragraph>No order-processing emails recorded yet.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Order</th>
                  <th style={th}>Email</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {orderProcessingEmailNotifications.map((n) => (
                  <tr key={n.id}>
                    <td style={td}>{new Date(n.notifiedAt).toLocaleString()}</td>
                    <td style={td}>{n.orderName || n.orderId}</td>
                    <td style={td}>{n.email || "—"}</td>
                    <td style={td}>
                      <ResultPill status={n.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* No slot="aside" here on purpose -- an aside forces Shopify's Page
          component into a narrower two-column layout, which is exactly
          the "boxed in with side space" look this page just moved away
          from. Rendered as a regular stacked section instead so it's
          full width like everything else on the page. */}
      <s-section heading="What each check means">
        <Explain summary="ℹ️ read_themes / read_products">
          <s-paragraph>
            If either fails, the recommendation email still sends but falls back to a plain text header (no store
            logo/social links) or a gray box instead of a real collection image.
          </s-paragraph>
        </Explain>
        <Explain summary="ℹ️ Google Sheets">
          <s-paragraph>
            "Not configured" is expected and harmless if you're not using the Sheet mirror — leads/events still
            save to the database regardless.
          </s-paragraph>
        </Explain>
        <Explain summary="ℹ️ Interakt">
          <s-paragraph>
            This only confirms the Secret Key itself is valid — it can't confirm the WhatsApp template is
            Meta-approved (green dot in Interakt's Templates Library), since that's not something the API exposes a
            check for. Use the Settings page's "Send Test" button to confirm the full send path.
          </s-paragraph>
        </Explain>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
