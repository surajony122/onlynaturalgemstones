/**
 * Custom toast system replacing this app's mix of native
 * `shopify.toast.show(...)` calls — matches the ONG Controls design's
 * dark bottom-right toast with an optional "Undo" action, consistently
 * across every page instead of some notifications looking like Shopify's
 * own admin chrome and others looking custom. Rendered once from the app
 * shell (app.jsx); any page calls `useToast()` to show one.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Icon, brand } from "./table-kit";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message, opts = {}) => {
      const id = ++idRef.current;
      const toast = { id, message, isError: !!opts.isError, undo: opts.undo || null };
      setToasts((prev) => [...prev, toast]);
      const timer = setTimeout(() => dismiss(id), opts.undo ? 6000 : 3200);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div style={{ position: "fixed", right: "24px", bottom: "24px", display: "flex", flexDirection: "column", gap: "10px", zIndex: 9999, alignItems: "flex-end" }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              minWidth: "280px",
              maxWidth: "420px",
              padding: "13px 15px",
              background: brand.ink,
              color: "#fff",
              borderRadius: "12px",
              boxShadow: "0 14px 34px -12px rgba(22,20,31,0.6)",
              animation: "ongPop 0.22s cubic-bezier(.22,.9,.3,1) both",
            }}
          >
            <Icon name={t.isError ? "x-circle" : "check-circle"} size={16} color={t.isError ? "#FCA5A5" : "#6EE7B7"} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: "13.5px", lineHeight: 1.4 }}>{t.message}</span>
            {t.undo && (
              <button
                type="button"
                onClick={() => {
                  t.undo();
                  dismiss(t.id);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 11px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              >
                <Icon name="undo" size={13} color="#fff" />
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              style={{ border: "none", background: "transparent", padding: "2px", display: "inline-flex", flexShrink: 0, cursor: "pointer" }}
            >
              <Icon name="x" size={13} color="rgba(255,255,255,0.55)" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast.show("Saved", { isError?, undo?: () => {} });` */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Shouldn't happen (ToastProvider wraps the whole app in app.jsx) —
    // fall back to a no-op rather than throwing, so a page never crashes
    // purely because a toast couldn't show.
    return { show: () => {} };
  }
  return ctx;
}
