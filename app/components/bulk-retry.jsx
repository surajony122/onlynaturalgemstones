import { brand } from "./table-kit";

const btn = (primary, busy) => ({
  fontSize: "12px",
  fontWeight: 600,
  padding: "6px 14px",
  borderRadius: "8px",
  border: `1px solid ${brand.accent}`,
  background: primary ? brand.accent : "#fff",
  color: primary ? "#fff" : brand.accent,
  cursor: busy ? "default" : "pointer",
  opacity: busy ? 0.6 : 1,
});

/**
 * Bulk "send the notification again" bar for a lead page.
 *   unsentCount / onRetryUnsent: every lead whose email or WhatsApp never went out (one click).
 *   selectedCount / onRetrySelected(mode): the rows ticked in the table; mode is "email", "whatsapp" or "both".
 */
export default function BulkRetryBar({ unsentCount, onRetryUnsent, selectedCount, onRetrySelected, busy, noun = "lead" }) {
  if (!unsentCount && !selectedCount) return null;
  const plural = (n) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "10px",
        padding: "10px 14px",
        background: "#fff",
        border: `1px solid ${brand.border}`,
        borderRadius: "10px",
        marginBottom: "12px",
      }}
    >
      {unsentCount > 0 && (
        <>
          <span style={{ fontSize: "12.5px", color: brand.body }}>
            <strong style={{ color: brand.ink }}>{plural(unsentCount)}</strong> did not get their notification.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm(`Send the missing email / WhatsApp message again to ${plural(unsentCount)}?`) && onRetryUnsent()}
            style={btn(true, busy)}
          >
            {busy ? "Sending…" : `↻ Retry all unsent (${unsentCount})`}
          </button>
        </>
      )}
      {selectedCount > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginLeft: unsentCount > 0 ? "auto" : 0 }}>
          <span style={{ fontSize: "12.5px", color: brand.body }}>{plural(selectedCount)} selected:</span>
          {[["email", "Retry email"], ["whatsapp", "Retry WhatsApp"], ["both", "Retry both"]].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={busy}
              onClick={() => window.confirm(`${label} for ${plural(selectedCount)}? This sends the message again, even if it was sent before.`) && onRetrySelected(mode)}
              style={btn(false, busy)}
            >
              ↻ {label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
