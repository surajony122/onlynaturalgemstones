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

export function FriendlyError({ message, detail }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div
      style={{
        background: "#fbe9e9",
        border: "1px solid #f1c4c4",
        borderRadius: "8px",
        padding: "12px 14px",
        fontSize: "13px",
      }}
    >
      <p style={{ margin: 0, color: "#8c2e21", fontWeight: 500 }}>{message}</p>
      {detail && (
        <>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              marginTop: "6px",
              fontSize: "12px",
              color: "#8c2e21",
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
                padding: "8px 10px",
                background: "#fff",
                border: "1px solid #f1c4c4",
                borderRadius: "6px",
                fontSize: "11px",
                color: "#6d7175",
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
    <span style={{ color: "#d82c0d", fontSize: "12px" }} title={detail || undefined}>
      {message}
    </span>
  );
}
