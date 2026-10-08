/**
 * Abandoned Checkouts: every recent abandoned checkout, read live from Shopify,
 * with what the reminder email did about it (sent / failed / skipped and why),
 * or what it WILL do and when. See utils/abandonedCheckoutEmail.server.js for
 * the rules. Staff can send one now, retry a failed one, or mark one do-not-email.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAbandonedCheckoutView,
  sendCheckoutNow,
  markDoNotEmail,
  runAbandonedCheckoutSweep,
} from "../utils/abandonedCheckoutEmail.server";
import { runAttentionAction } from "../utils/attentionActions.server";
import { brand, Icon, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const days = new URL(request.url).searchParams.get("days") || "7";
  return getAbandonedCheckoutView({ admin, shop: session.shop, days });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const checkoutId = String(form.get("checkoutId") || "");

  try {
    if (intent === "sendNow") {
      const r = await sendCheckoutNow({ admin, shop: session.shop, checkoutId });
      return { intent, checkoutId, ...r };
    }
    if (intent === "retry") {
      const r = await runAttentionAction({ admin, shop: session.shop, intent: "retry", kind: "abandoned-email", id: String(form.get("logId") || "") });
      return { intent, checkoutId, ...r };
    }
    if (intent === "skip") {
      const r = await markDoNotEmail({
        shop: session.shop,
        checkoutId,
        checkoutName: String(form.get("name") || ""),
        email: String(form.get("email") || ""),
        customerName: String(form.get("customer") || ""),
      });
      return { intent, checkoutId, ...r };
    }
    if (intent === "runNow") {
      const r = await runAbandonedCheckoutSweep({ admin, shop: session.shop, dryRun: false });
      return { intent, ok: !r.error, error: r.error, sent: r.sent, failed: r.failed, waiting: r.waiting, skipped: r.skipped, enabled: r.enabled };
    }
  } catch (err) {
    console.error("[app.abandoned-checkouts] action failed:", err);
    return { intent, checkoutId, ok: false, status: "error: " + String((err && err.message) || err) };
  }
  return { intent, ok: false, status: "error: unknown action" };
};

// ---------------------------------------------------------------- helpers

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const STATES = {
  sent: { label: "Email sent", color: brand.success, bg: brand.successBg, line: brand.successLine },
  failed: { label: "Failed", color: brand.danger, bg: brand.dangerBg, line: brand.dangerLine },
  "will-send": { label: "Will send", color: brand.accent, bg: brand.accentTint, line: brand.accentLine },
  off: { label: "Emails off", color: brand.warn, bg: brand.warnBg, line: brand.warnLine },
  waiting: { label: "Waiting", color: brand.muted, bg: brand.panel, line: brand.border },
  skipped: { label: "Not emailed", color: brand.muted, bg: brand.panel, line: brand.border },
  recovered: { label: "Recovered", color: brand.success, bg: brand.successBg, line: brand.successLine },
  sending: { label: "Sending…", color: brand.accent, bg: brand.accentTint, line: brand.accentLine },
};

function StateTag({ state }) {
  const t = STATES[state] || STATES.skipped;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: "999px", border: `1px solid ${t.line}`, background: t.bg, color: t.color, fontSize: "11.5px", fontWeight: 600, whiteSpace: "nowrap" }}>
      {t.label}
    </span>
  );
}

const btnBase = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 11px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

function RowActions({ row }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : null;

  useEffect(() => {
    if (!result) return;
    if (result.intent === "sendNow" || result.intent === "retry") {
      if (result.ok) toast.show("Email sent to " + row.email);
      else toast.show(result.status || result.error || "Could not send", { isError: true });
    } else if (result.intent === "skip") {
      if (result.ok) toast.show("Marked do-not-email");
      else toast.show(result.status || "Could not save", { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const go = (intent, extra = {}) => fetcher.submit({ intent, checkoutId: row.id, logId: row.logId || "", name: row.name, email: row.email, customer: row.customer, ...extra }, { method: "post" });
  const running = busy ? fetcher.formData?.get("intent") : null;

  if (!row.canSendNow && !row.canRetry && !row.canSkip) return <span style={{ color: brand.faint, fontSize: "12px" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {row.canRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm(`Try sending the email to ${row.email} again?`) && go("retry")}
          style={{ ...btnBase, border: `1px solid ${brand.accent}`, background: brand.accent, color: "#fff", opacity: busy ? 0.7 : 1 }}
        >
          <Icon name="refresh" size={12} color="currentColor" />
          {running === "retry" ? "Retrying…" : "Retry"}
        </button>
      )}
      {row.canSendNow && !row.canRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm(`Send the abandoned checkout email to ${row.email} now?`) && go("sendNow")}
          style={{ ...btnBase, border: `1px solid ${brand.accent}`, background: brand.accent, color: "#fff", opacity: busy ? 0.7 : 1 }}
        >
          <Icon name="send" size={12} color="currentColor" />
          {running === "sendNow" ? "Sending…" : "Send now"}
        </button>
      )}
      {row.canSkip && (
        <button
          type="button"
          disabled={busy}
          title="Never email this checkout"
          onClick={() => window.confirm("Never send the abandoned checkout email for this checkout?") && go("skip")}
          style={{ ...btnBase, border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, opacity: busy ? 0.7 : 1 }}
        >
          <Icon name="ban" size={12} color="currentColor" />
          {running === "skip" ? "Saving…" : "Don't email"}
        </button>
      )}
    </div>
  );
}

function Banner({ tone, icon, children }) {
  const t = tone === "danger" ? { c: brand.danger, bg: brand.dangerBg, l: brand.dangerLine } : { c: brand.warn, bg: brand.warnBg, l: brand.warnLine };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 16px", background: t.bg, border: `1px solid ${t.l}`, borderRadius: "12px", marginBottom: "14px", fontSize: "13px", color: brand.body, lineHeight: 1.55 }}>
      <Icon name={icon} size={16} color={t.c} style={{ flexShrink: 0, marginTop: "2px" }} />
      <div>{children}</div>
    </div>
  );
}

const FILTERS = [
  ["all", "All"],
  ["will-send", "Will send"],
  ["waiting", "Waiting"],
  ["sent", "Sent"],
  ["failed", "Failed"],
  ["skipped", "Not emailed"],
  ["recovered", "Recovered"],
];

// ---------------------------------------------------------------- page

export default function AbandonedCheckoutsPage() {
  const view = useLoaderData();
  const runFetcher = useFetcher();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const running = runFetcher.state !== "idle";
  useEffect(() => {
    const r = runFetcher.state === "idle" ? runFetcher.data : null;
    if (!r || r.intent !== "runNow") return;
    if (r.ok) toast.show(`Check finished: ${r.sent} sent, ${r.failed} failed, ${r.waiting} waiting.`);
    else toast.show(r.error || "The check failed", { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetcher.data, runFetcher.state]);

  const c = view.counts || {};
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (view.rows || []).filter((r) => {
      if (filter === "will-send" && !(r.state === "will-send" || r.state === "off")) return false;
      if (filter !== "all" && filter !== "will-send" && r.state !== filter) return false;
      if (!q) return true;
      return [r.name, r.customer, r.email, ...r.items.map((i) => i.title)].join(" ").toLowerCase().includes(q);
    });
  }, [view.rows, filter, search]);

  const countFor = (key) => (key === "all" ? c.total || 0 : key === "will-send" ? (c["will-send"] || 0) + (c.off || 0) : c[key] || 0);

  return (
    <PageIn>
      <PageHeader
        title="Abandoned Checkouts"
        description="Every abandoned checkout from Shopify, and what the reminder email did about it."
        stats={[
          { label: "Checkouts", value: c.total || 0 },
          { label: "Sent", value: c.sent || 0, tone: "success" },
          { label: "Failed", value: c.failed || 0, tone: (c.failed || 0) > 0 ? "danger" : undefined },
          { label: "Will send", value: (c["will-send"] || 0) + (c.off || 0) },
          { label: "Recovered", value: c.recovered || 0, tone: "success" },
        ]}
        info={
          <>
            <p style={{ margin: "0 0 8px" }}>
              This list is read live from Shopify's abandoned checkouts. Next to each one you can see whether the reminder email was sent, failed,
              was skipped (and why), or is still waiting for its turn.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              An email goes out once per checkout, after it has been idle for the wait time in Settings → Emails (currently {view.delayMinutes} minutes), only
              to customers who agreed to email marketing, who haven't ordered since, haven't unsubscribed and weren't emailed in the last 24 hours.
            </p>
            <p style={{ margin: 0 }}>“Send now” skips the wait but keeps those protections.</p>
          </>
        }
        actions={
          <>
            <Link to="/app/settings" style={{ ...btnBase, border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, textDecoration: "none", padding: "8px 14px", fontSize: "13px" }}>
              <Icon name="gear" size={14} color="currentColor" />
              Email settings
            </Link>
            {view.enabled && view.gmailReady && (
              <button
                type="button"
                disabled={running}
                onClick={() => window.confirm("Send every email that is due right now?") && runFetcher.submit({ intent: "runNow" }, { method: "post" })}
                style={{ ...btnBase, border: `1px solid ${brand.accent}`, background: brand.accent, color: "#fff", padding: "8px 14px", fontSize: "13px", opacity: running ? 0.7 : 1 }}
              >
                <Icon name="send" size={14} color="currentColor" />
                {running ? "Running…" : "Send due emails now"}
              </button>
            )}
          </>
        }
      />

      {view.error && (
        <Banner tone="danger" icon="alert-triangle">
          <strong>Could not read abandoned checkouts from Shopify.</strong> {view.error}
        </Banner>
      )}
      {!view.error && !view.enabled && (
        <Banner tone="warn" icon="info">
          Abandoned checkout emails are <strong>switched off</strong>, so nothing is being sent. Turn them on in{" "}
          <Link to="/app/settings" style={{ color: brand.accent, fontWeight: 600 }}>Settings → Emails</Link>. The list below shows what would happen to each checkout.
        </Banner>
      )}
      {!view.error && view.enabled && !view.gmailReady && (
        <Banner tone="danger" icon="alert-triangle">
          Gmail is not connected, so no emails can be sent. Connect it in{" "}
          <Link to="/app/settings" style={{ color: brand.accent, fontWeight: 600 }}>Settings → Connections</Link>.
        </Banner>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        {FILTERS.map(([key, label]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              style={{
                padding: "6px 12px",
                borderRadius: "999px",
                border: `1px solid ${active ? brand.accent : brand.border}`,
                background: active ? brand.accentTint : "#fff",
                color: active ? brand.ink : brand.muted,
                fontSize: "12.5px",
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {label} <span style={{ color: brand.faint, marginLeft: "3px" }}>{countFor(key)}</span>
            </button>
          );
        })}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or item…"
          style={{ marginLeft: "auto", minWidth: "230px", padding: "8px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px", fontFamily: "inherit" }}
        />
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: brand.muted }}>
          Last
          {[3, 7, 14, 30].map((d) => (
            <Link
              key={d}
              to={`?days=${d}`}
              style={{ padding: "4px 9px", borderRadius: "7px", border: `1px solid ${view.windowDays === d ? brand.accent : brand.border}`, background: view.windowDays === d ? brand.accentTint : "#fff", color: brand.body, textDecoration: "none", fontWeight: view.windowDays === d ? 600 : 500 }}
            >
              {d}d
            </Link>
          ))}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: "13px", color: brand.muted }}>
            {view.error
              ? "Nothing to show until Shopify can be read."
              : (view.rows || []).length === 0
              ? `Shopify has no abandoned checkouts in the last ${view.windowDays} days.`
              : "No checkouts match this filter."}
          </p>
        </Card>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Checkout</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Cart</th>
                <th style={thStyle}>Total</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 600, color: brand.ink }}>{r.name || "Checkout"}</div>
                    <div style={{ fontSize: "11.5px", color: brand.muted }} title={r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}>
                      {timeAgo(r.createdAt)}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: brand.ink }}>{r.customer || "Unnamed"}</div>
                    <div style={{ fontSize: "11.5px", color: brand.muted }}>{r.email || "no email"}</div>
                    <div style={{ fontSize: "11px", color: r.consent ? brand.success : brand.faint, marginTop: "2px" }}>
                      {r.consent ? "Agreed to email marketing" : "No email marketing consent"}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: "240px" }} title={r.items.map((i) => `${i.quantity} × ${i.title}`).join("\n")}>
                    <div style={{ color: brand.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.items[0] ? r.items[0].title : "Empty cart"}</div>
                    <div style={{ fontSize: "11.5px", color: brand.muted }}>
                      {r.items.length} item{r.items.length === 1 ? "" : "s"}
                      {r.items.length > 1 ? ` (+${r.items.length - 1} more)` : ""}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.total}</td>
                  <td style={{ ...tdStyle, maxWidth: "300px" }}>
                    <StateTag state={r.state} />
                    <div style={{ fontSize: "11.5px", color: r.state === "failed" ? brand.danger : brand.muted, marginTop: "4px", lineHeight: 1.45, wordBreak: "break-word" }}>
                      {r.reason}
                      {r.sentAt ? ` · ${timeAgo(r.sentAt)}` : ""}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <RowActions row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageIn>
  );
}
