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
import nodemailer from "nodemailer";
import { google } from "googleapis";

const STORE_DOMAIN = "onlynaturalgemstones.com";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)),
  ]);
}

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

async function checkGmail(settings) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return { ok: false, detail: "Not configured — set Gmail address + App Password on the Settings page." };
  }
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    });
    await withTimeout(transporter.verify(), 8000, "Gmail SMTP");
    return { ok: true, detail: `Authenticated as ${settings.gmailUser}` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

async function checkGoogleSheets(settings) {
  if (!settings.googleServiceAccountEmail || !settings.googleServiceAccountPrivateKey || !settings.astroLeadsSpreadsheetId) {
    return { ok: null, detail: "Not configured — optional, leads/events still save to the database regardless." };
  }
  try {
    const privateKey = settings.googleServiceAccountPrivateKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: settings.googleServiceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await withTimeout(
      sheets.spreadsheets.get({ spreadsheetId: settings.astroLeadsSpreadsheetId }),
      8000,
      "Google Sheets"
    );
    return { ok: true, detail: `Connected to "${meta.data.properties?.title || settings.astroLeadsSpreadsheetId}"` };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

async function checkInterakt(settings) {
  if (!settings.interaktApiKey) {
    return { ok: null, detail: "Not configured — set the Secret Key on the Settings page (WhatsApp section)." };
  }
  try {
    // Contacts Retrieval API, limit=1 — the lightest real call Interakt
    // offers that both proves the key is valid and never sends/costs
    // anything (unlike the Send Template API, which would actually
    // message someone just to run a health check).
    const res = await withTimeout(
      fetch("https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=1", {
        headers: { Authorization: "Basic " + settings.interaktApiKey },
      }),
      8000,
      "Interakt API"
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: `HTTP ${res.status}: Secret Key rejected — check it's copied correctly from Interakt → Settings → Developer Setting.` };
    }
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, detail: `Secret Key valid. Template in use: "${settings.interaktTemplateName || "gem_recommendation (default)"}" — this doesn't confirm the template itself is Meta-approved, only that the key works.` };
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

  const [database, shopifyAdmin, readThemes, readProducts, gmail, googleSheets, interakt, recentLeads, orderProcessingNotifications, registeredWebhooks, webhookReceipts] = await Promise.all([
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
    registeredWebhooks,
    webhookReceipts,
  };
};

const statusColor = (ok) => (ok === true ? "#008060" : ok === null ? "#8c9196" : "#d82c0d");
const statusLabel = (ok) => (ok === true ? "OK" : ok === null ? "Not configured" : "FAILING");

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", verticalAlign: "top" };

export default function ServerHealthPage() {
  const { checkedAt, checks, recentLeads, orderProcessingNotifications, registeredWebhooks, webhookReceipts } = useLoaderData();
  const failingCount = checks.filter((c) => c.ok === false).length;

  return (
    <s-page heading="Server">
      <s-section heading={failingCount === 0 ? "All checks passing" : `${failingCount} check(s) failing`}>
        <s-paragraph>
          Live check of every part this app depends on — database, Shopify Admin API access (including the specific
          scopes the recommendation email needs), Gmail sending, and the optional Google Sheets mirror. Reload the
          page to re-run. Last checked: {new Date(checkedAt).toLocaleString()}.
        </s-paragraph>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
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
                <td style={td}>{c.name}</td>
                <td style={td}>
                  <span style={{ color: statusColor(c.ok), fontWeight: "bold" }}>{statusLabel(c.ok)}</span>
                </td>
                <td style={{ ...td, color: "#5c4a3d", fontFamily: c.ok === false ? "monospace" : "inherit", fontSize: c.ok === false ? "11px" : "13px" }}>
                  {c.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>

      <s-section heading={`Recent lead issues (last 7 days — ${recentLeads.totalLast7Days} lead(s) total)`}>
        {recentLeads.issues.length === 0 ? (
          <s-paragraph>No issues found among leads from the last 7 days.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                  <td style={{ ...td, color: "#d82c0d" }}>
                    {issue.problems.map((p, i) => (
                      <div key={i}>
                        • {p}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Webhook receipts (definitive)">
        <s-paragraph>
          Every real hit this server has received on <s-text>/webhooks/orders/updated</s-text> — logged
          unconditionally, before anything else runs. Unlike the other checks below, an empty list here can only
          mean one thing: Shopify never actually called this endpoint. If it's empty even after a real order was
          marked "as in progress," the subscription itself isn't taking effect — worth a fresh{" "}
          <s-text>shopify app deploy</s-text> or checking the Partner Dashboard directly.
        </s-paragraph>
        {webhookReceipts.length === 0 ? (
          <s-paragraph>No webhook calls received yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Topic</th>
                <th style={th}>Order ID</th>
              </tr>
            </thead>
            <tbody>
              {webhookReceipts.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{new Date(r.receivedAt).toLocaleString()}</td>
                  <td style={td}>{r.topic}</td>
                  <td style={td}>{r.orderId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Registered webhooks (unreliable for managed/TOML webhooks — see receipts above instead)">
        <s-paragraph>
          Queries Shopify's classic <s-text>webhookSubscriptions</s-text> API — turns out this does NOT reflect
          TOML-declared "managed" webhooks (confirmed: it showed zero even for{" "}
          <s-text>orders/create</s-text>, which demonstrably works today). Kept for reference, but the "Webhook
          receipts" section above is the actual reliable answer.
        </s-paragraph>
        {!registeredWebhooks.ok ? (
          <s-paragraph>
            <s-text>Failed to check: {registeredWebhooks.error}</s-text>
          </s-paragraph>
        ) : registeredWebhooks.subscriptions.length === 0 ? (
          <s-paragraph>No webhooks registered at all — unexpected, worth investigating.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        )}
      </s-section>

      <s-section heading="Order Processing WhatsApp notifications">
        <s-paragraph>
          One row per order the webhook found IN_PROGRESS and attempted to notify — see{" "}
          <s-text>webhooks.orders.updated.jsx</s-text>. An EMPTY list here, after you've actually marked a real
          order "as in progress," is itself the diagnostic: it means the webhook either never fired from Shopify at
          all, or fired but never found an IN_PROGRESS fulfillment order for that order.
        </s-paragraph>
        {orderProcessingNotifications.length === 0 ? (
          <s-paragraph>No order-processing notifications recorded yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                  <td style={{ ...td, color: n.status?.startsWith("OK") ? "#008060" : "#d82c0d" }}>{n.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section slot="aside" heading="What each check means">
        <s-paragraph>
          <strong>read_themes / read_products</strong>: if either fails, the recommendation email still sends but
          falls back to a plain text header (no store logo/social links) or a gray box instead of a real collection
          image.
        </s-paragraph>
        <s-paragraph>
          <strong>Google Sheets</strong>: "Not configured" is expected and harmless if you're not using the Sheet
          mirror — leads/events still save to the database regardless.
        </s-paragraph>
        <s-paragraph>
          <strong>Interakt</strong>: this only confirms the Secret Key itself is valid — it can't confirm the
          WhatsApp template is Meta-approved (green dot in Interakt's Templates Library), since that's not something
          the API exposes a check for. Use the Settings page's "Send Test" button to confirm the full send path.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
