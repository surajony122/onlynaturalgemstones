import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  DEFAULT_RATES,
  fetchCustomisationStatus,
  buildGemstoneCustomisationMatrix,
} from "../utils/gemstoneCustomisationMatrix.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill, brand } from "../components/table-kit";
import { FriendlyError, FriendlyErrorInline } from "../components/friendly-error";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let customisationStatus = { found: false, totalVariants: 0 };
  try {
    customisationStatus = await fetchCustomisationStatus(admin);
  } catch (err) {
    console.error("[app._index] loader fetchCustomisationStatus error:", err);
  }

  return {
    shopDomain: (session.shop || "").replace(".myshopify.com", ""),
    customisationStatus,
    defaultRates: DEFAULT_RATES,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "refreshStatus") {
    try {
      const status = await fetchCustomisationStatus(admin);
      return { intent, ok: true, customisationStatus: status };
    } catch (err) {
      console.error("[app._index] refreshStatus failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "rebuildCustomisationMatrix") {
    try {
      const rates = JSON.parse(formData.get("rates") || "{}");
      const result = await buildGemstoneCustomisationMatrix(admin, rates);
      const updatedStatus = await fetchCustomisationStatus(admin);
      return { intent, ok: true, ...result, customisationStatus: updatedStatus };
    } catch (err) {
      console.error("[app._index] rebuildCustomisationMatrix failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

export default function Index() {
  const { shopDomain, customisationStatus: initialStatus, defaultRates } = useLoaderData();
  const matrixFetcher = useFetcher();
  const refreshFetcher = useFetcher();
  const shopify = useAppBridge();

  const [status, setStatus] = useState(initialStatus || {});
  const [rates, setRates] = useState(defaultRates || {});

  const isBuilding = matrixFetcher.state === "submitting";
  const isRefreshing = refreshFetcher.state === "submitting";

  useEffect(() => {
    if (matrixFetcher.data?.customisationStatus) {
      setStatus(matrixFetcher.data.customisationStatus);
    }
    if (matrixFetcher.data?.ok) {
      shopify.toast.show(`Successfully synced ${matrixFetcher.data.totalVariants || 0} customization variants!`);
    } else if (matrixFetcher.data?.error) {
      shopify.toast.show(`Error: ${matrixFetcher.data.error}`, { isError: true });
    }
  }, [matrixFetcher.data, shopify]);

  useEffect(() => {
    if (refreshFetcher.data?.customisationStatus) {
      setStatus(refreshFetcher.data.customisationStatus);
      shopify.toast.show("Status refreshed!");
    }
  }, [refreshFetcher.data, shopify]);

  const handleRateChange = (key, value) => {
    setRates((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleRebuild = () => {
    matrixFetcher.submit(
      {
        intent: "rebuildCustomisationMatrix",
        rates: JSON.stringify(rates),
      },
      { method: "post" },
    );
  };

  const handleRefresh = () => {
    refreshFetcher.submit({ intent: "refreshStatus" }, { method: "post" });
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 20px 80px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <TableGlobalStyles />

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", color: "#fff", padding: "28px 32px", borderRadius: 16, marginBottom: 28, boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 12, backdropFilter: "blur(4px)" }}>
              💎 Shubh Gems Jewelry Engine
            </div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Daily Metal Rates & Gemstone Customisation Matrix
            </h1>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 14, maxWidth: 640, lineHeight: 1.5 }}>
              Update daily gold/silver rates here. The app automatically recalculates and syncs all design prices to <strong>Gemstone Customisation</strong> in Shopify.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isBuilding}
              style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: isRefreshing ? "wait" : "pointer" }}
            >
              {isRefreshing ? "Refreshing..." : "↻ Refresh Status"}
            </button>
          </div>
        </div>
      </div>

      {/* Error Displays */}
      {matrixFetcher.data?.error && (
        <div style={{ marginBottom: 24 }}>
          <FriendlyError title="Matrix Build Error" error={matrixFetcher.data.error} />
        </div>
      )}

      {/* Live Helper Product Status Card */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
          <span>📦</span> Matrix Target Product
        </h2>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Target Product</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Active Variants</th>
                <th style={thStyle}>Catalog Types</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600, color: "#0f172a" }}>
                  {status.title || "Gemstone Customisation"}
                </td>
                <td style={tdStyle}>
                  {status.found ? (
                    <Pill color="green">✓ Active in Store</Pill>
                  ) : (
                    <Pill color="amber">⏳ Ready to Create</Pill>
                  )}
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, fontSize: 14, color: brand }}>
                  {status.totalVariants || 0} variants
                </td>
                <td style={{ ...tdStyle, color: "#64748b", fontSize: 13 }}>
                  Rings, Pendants, Bracelets (All Metals & Designs)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Metal Rates Editor */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚖️</span> Daily Metal Rates & Pricing Formula
            </h2>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
              Enter current market prices per gram. Prices include making charges and GST automatically.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              Silver (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates.silver || 0}
                onChange={(e) => handleRateChange("silver", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              22K Yellow Gold (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates["22k-yellow"] || 0}
                onChange={(e) => handleRateChange("22k-yellow", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              18K Yellow Gold (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates["18k-yellow"] || 0}
                onChange={(e) => handleRateChange("18k-yellow", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              18K White Gold (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates["18k-white"] || 0}
                onChange={(e) => handleRateChange("18k-white", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              14K Yellow Gold (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates["14k-yellow"] || 0}
                onChange={(e) => handleRateChange("14k-yellow", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              14K White Gold (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates["14k-white"] || 0}
                onChange={(e) => handleRateChange("14k-white", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              Panchdhatu (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates.panchdhatu || 0}
                onChange={(e) => handleRateChange("panchdhatu", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              Tamba / Copper (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates.copper || 0}
                onChange={(e) => handleRateChange("copper", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              Making Charges (per gram)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>₹</span>
              <input
                type="number"
                step="any"
                value={rates.makingCharge || 0}
                onChange={(e) => handleRateChange("makingCharge", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>

          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              Tax / GST Rate (%)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#64748b", fontWeight: 600 }}>%</span>
              <input
                type="number"
                step="any"
                value={rates.taxRate || 0}
                onChange={(e) => handleRateChange("taxRate", e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
              />
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #f1f5f9", paddingTop: 18 }}>
          <button
            onClick={handleRebuild}
            disabled={isBuilding}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              border: "none",
              background: isBuilding ? "#94a3b8" : "linear-gradient(135deg, #059669 0%, #047857 100%)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: isBuilding ? "wait" : "pointer",
              boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {isBuilding ? (
              <>
                <span className="shubh-spinner" style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }}></span>
                Calculating & Syncing Matrix...
              </>
            ) : (
              <>🚀 Save Rates & Rebuild Customisation Matrix</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useLoaderData());
}
