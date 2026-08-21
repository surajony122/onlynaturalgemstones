/**
 * Plain-language error display for a non-technical store owner. Every
 * page in this app used to dump raw error strings (GraphQL error JSON,
 * "TypeError: fetch failed", stack-trace-shaped text) straight into the
 * UI — fine for a developer, alarming and meaningless for someone using
 * this app solo without one. Each call site now writes its own short,
 * specific sentence about what failed (the only thing that page knows
 * and this component can't guess), and the raw detail is tucked behind
 * a "Show technical details" toggle instead of shown by default — still
 * there for support/debugging, just not the first thing a merchant sees.
 * Not a route — lives outside app/routes so fs-routes skips it.
 */
import { useState } from "react";

const RED = "#DC2626";
const RED_TINT = "#FEF2F2";
const RED_BORDER = "#FBD5D5";

export function FriendlyError({ message, detail }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div
      style={{
        background: RED_TINT,
        border: `1px solid ${RED_BORDER}`,
        borderRadius: "12px",
        padding: "13px 16px",
        fontSize: "12.5px",
        boxShadow: "0 1px 2px rgba(16,24,40,0.05)",
      }}
    >
      <p style={{ margin: 0, color: RED, fontWeight: 500 }}>{message}</p>
      {detail && (
        <>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              marginTop: "6px",
              fontSize: "11.5px",
              color: RED,
              background: "none",
              border: "none",
              padding: 0,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {showDetail ? "Hide" : "Show"} technical details
          </button>
          {showDetail && (
            <pre
              style={{
                marginTop: "8px",
                padding: "9px 11px",
                background: "#fff",
                border: `1px solid ${RED_BORDER}`,
                borderRadius: "8px",
                fontSize: "11px",
                color: "#6B7280",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "160px",
                overflowY: "auto",
              }}
            >
              {detail}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/** Same idea, inline/compact — for a table cell or a spot under a
 * button where the full card treatment above is too heavy. Just the
 * friendly sentence, red, with the detail as a native title tooltip
 * (still reachable, still not shoved in the merchant's face). */
export function FriendlyErrorInline({ message, detail }) {
  return (
    <span style={{ color: RED, fontSize: "12px" }} title={detail || undefined}>
      {message}
    </span>
  );
}
