/**
 * The "Needs attention" panel: every failed message / lead / invoice from the last 7 days, with what went wrong,
 * where to fix it and one-click Retry / Mark-as-resolved buttons, plus "Retry all unsent" for leads whose message
 * never went out. Shared by the Overview and the System Health page; the page that uses it must export an `action`
 * that handles { intent: "retry" | "dismiss", kind, id } and { intent: "retryUnsent", kind }
 * (see app.overview.jsx / app.server-health.jsx).
 */
import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { brand, Icon } from "./table-kit";
import { useToast } from "./toast";

export function timeAgo(iso) {
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

function BadTag({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: "999px",
        border: `1px solid ${brand.dangerLine}`,
        background: brand.dangerBg,
        color: brand.danger,
        fontSize: "11.5px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

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

// "Retry all unsent (N)" for one kind of lead.
function BulkRetryButton({ bulk }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : null;

  useEffect(() => {
    if (!result || result.intent !== "retryUnsent") return;
    if (!result.ok) {
      toast.show(result.error || "Could not retry", { isError: true });
      return;
    }
    const parts = [];
    if (result.emailOk) parts.push(result.emailOk + " email" + (result.emailOk === 1 ? "" : "s") + " sent");
    if (result.waOk) parts.push(result.waOk + " WhatsApp message" + (result.waOk === 1 ? "" : "s") + " sent");
    if (result.failed) parts.push(result.failed + " still failed");
    toast.show(parts.length ? parts.join(", ") : "Nothing needed sending", { isError: !!result.failed && !result.emailOk && !result.waOk });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => window.confirm(`Send the missing email / WhatsApp message again to ${bulk.count} lead${bulk.count === 1 ? "" : "s"}?`) && fetcher.submit({ intent: "retryUnsent", kind: bulk.kind }, { method: "post" })}
      style={{ ...smallButton, border: "1px solid " + brand.accent, background: brand.accent, color: "#fff", opacity: busy ? 0.7 : 1 }}
    >
      <Icon name="refresh" size={12} color="currentColor" style={{ animation: busy ? "ongSpin 0.8s linear infinite" : "none" }} />
      {busy ? "Sending…" : `Retry all unsent (${bulk.count})`}
    </button>
  );
}

export default function AttentionPanel({ attention }) {
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
        <span style={{ fontSize: "12.5px", color: brand.muted }}>No failed or unsent messages, leads or invoices in the last 7 days.</span>
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
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: a.severity === "warn" ? brand.warn : brand.danger, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: "220px", fontSize: "14px", fontWeight: 600, color: brand.ink }}>{a.title}</div>
            {a.bulk && <BulkRetryButton bulk={a.bulk} />}
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

          {a.detail && a.bulk && (
            <div style={{ margin: "8px 0 0 22px", fontSize: "12.5px", color: brand.muted, lineHeight: 1.5 }}>{a.detail}</div>
          )}

          {a.details && a.details.length > 0 && (
            <div style={{ margin: "12px 0 0 22px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {a.details.map((d, i) => (
                <div key={i} style={{ background: brand.panel, border: `1px solid ${brand.divider}`, borderRadius: "10px", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: brand.ink }}>{d.subject}</span>
                    <BadTag>{d.source}</BadTag>
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
