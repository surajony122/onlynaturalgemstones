import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  fetchCustomisationStatus,
  buildGemstoneCustomisationMatrix,
  runFullSystemDiagnostics,
  fetchCustomisationVariantsPreview,
} from "../utils/gemstoneCustomisationMatrix.server";
import { getAppSettings, saveMetalRates, ratesFromAppSettings } from "../utils/appSettings.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill, brand } from "../components/table-kit";
import { FriendlyError } from "../components/friendly-error";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let customisationStatus = { found: false, totalVariants: 0 };
  let systemChecks = [];
  let variantsPreview = [];
  try {
    customisationStatus = await fetchCustomisationStatus(admin);
    systemChecks = await runFullSystemDiagnostics(admin);
    variantsPreview = await fetchCustomisationVariantsPreview(admin);
  } catch (err) {
    console.error("[app._index] loader diagnostics error:", err);
  }

  const settings = await getAppSettings(session.shop);

  return {
    shopDomain: (session.shop || "").replace(".myshopify.com", ""),
    customisationStatus,
    systemChecks,
    variantsPreview,
    // Saved rates (this dashboard's own "Save Rates & Rebuild..." button)
    // take priority over the hardcoded defaults -- same
    // saved-row-wins-else-fallback pattern the rest of AppSettings uses.
    defaultRates: ratesFromAppSettings(settings),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "runDiagnostics") {
    try {
      const status = await fetchCustomisationStatus(admin);
      const checks = await runFullSystemDiagnostics(admin);
      return { intent, ok: true, customisationStatus: status, systemChecks: checks };
    } catch (err) {
      console.error("[app._index] runDiagnostics failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "rebuildCustomisationMatrix") {
    try {
      const rates = JSON.parse(formData.get("rates") || "{}");
      // Persists the entered rates FIRST -- this is what the button's own
      // "Save Rates & ..." label already promised, but previously never
      // actually happened (rates only ever lived in React state, reset
      // to DEFAULT_RATES on every page load). proxy.metal-rates.jsx reads
      // this same saved row to serve the storefront, so saving it here is
      // also what makes live pricing use these rates going forward.
      await saveMetalRates(session.shop, rates);
      const result = await buildGemstoneCustomisationMatrix(admin, rates);
      const updatedStatus = await fetchCustomisationStatus(admin);
      const checks = await runFullSystemDiagnostics(admin);
      return { intent, ok: true, ...result, customisationStatus: updatedStatus, systemChecks: checks };
    } catch (err) {
      console.error("[app._index] rebuildCustomisationMatrix failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

export default function Index() {
  const { shopDomain, customisationStatus: initialStatus, systemChecks: initialChecks, variantsPreview: initialPreview, defaultRates } = useLoaderData();
  const matrixFetcher = useFetcher();
  const diagFetcher = useFetcher();
  const shopify = useAppBridge();

  const [status, setStatus] = useState(initialStatus || {});
  const [checks, setChecks] = useState(initialChecks || []);
  const [preview, setPreview] = useState(initialPreview || []);
  const [previewTypeFilter, setPreviewTypeFilter] = useState("all");
  const [rates, setRates] = useState(defaultRates || {});
  const [activeTab, setActiveTab] = useState("pricing"); // "pricing" | "diagnostics" | "troubleshooting"

  const isBuilding = matrixFetcher.state === "submitting";
  const isChecking = diagFetcher.state === "submitting";

  useEffect(() => {
    if (matrixFetcher.data?.customisationStatus) {
      setStatus(matrixFetcher.data.customisationStatus);
    }
    if (matrixFetcher.data?.systemChecks) {
      setChecks(matrixFetcher.data.systemChecks);
    }
    if (matrixFetcher.data?.preview) {
      setPreview(matrixFetcher.data.preview);
    }
    if (matrixFetcher.data?.ok) {
      shopify.toast.show(`Successfully synced ${matrixFetcher.data.totalVariants || 0} customization variants!`);
    } else if (matrixFetcher.data?.error) {
      shopify.toast.show(`Error: ${matrixFetcher.data.error}`, { isError: true });
    }
  }, [matrixFetcher.data, shopify]);

  useEffect(() => {
    if (diagFetcher.data?.customisationStatus) {
      setStatus(diagFetcher.data.customisationStatus);
    }
    if (diagFetcher.data?.systemChecks) {
      setChecks(diagFetcher.data.systemChecks);
      shopify.toast.show("Diagnostics completed!");
    }
  }, [diagFetcher.data, shopify]);

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

  const handleRunDiagnostics = () => {
    diagFetcher.submit({ intent: "runDiagnostics" }, { method: "post" });
  };

  const allPassed = checks.length > 0 && checks.every((c) => c.status === "PASS");

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 80px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <TableGlobalStyles />

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", color: "#fff", padding: "28px 32px", borderRadius: 16, marginBottom: 24, boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 12, backdropFilter: "blur(4px)" }}>
              💎 Shubh Gems Customization Command Center
            </div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Daily Metal Rates, Live Health & Customisation Matrix
            </h1>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 14, maxWidth: 680, lineHeight: 1.5 }}>
              Central dashboard for managing daily gold & silver rates, monitoring live customization health, and self-healing common storefront errors in 1 click.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={handleRunDiagnostics}
              disabled={isChecking || isBuilding}
              style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: isChecking ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              {isChecking ? "Checking..." : "🩺 Run Full Diagnostics"}
            </button>
          </div>
        </div>

        {/* Quick Health Status Pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: "6px 12px", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.found ? "#22c55e" : "#eab308" }}></span>
            <span>Target: <strong>Gemstone Customisation</strong> ({status.totalVariants || 0} variants)</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: "6px 12px", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: allPassed ? "#22c55e" : "#38bdf8" }}></span>
            <span>System Health: <strong>{allPassed ? "All Systems Operational" : "Healthy"}</strong></span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: "6px 12px", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span>🛒</span>
            <span>Checkout Flow: <strong>Atomic (Qty: 1)</strong></span>
          </div>
        </div>
      </div>

      {/* Big, unmissable, plain-English alert — shows the instant the app
          opens, regardless of which tab is active, so a non-technical
          merchant sees it without needing to know to click "Diagnostics"
          or "Troubleshooting". Built from the same checks as those tabs;
          "canRebuildFix" issues get the Rebuild button right here so
          fixing it is one click from the first thing you see. */}
      {checks.filter((c) => c.status !== "PASS").length > 0 && (
        <div style={{ background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 14, padding: "18px 22px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>
              ⚠️ {checks.filter((c) => c.status !== "PASS").length === 1 ? "1 issue needs" : `${checks.filter((c) => c.status !== "PASS").length} issues need`} your attention
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#7f1d1d", fontSize: 13, lineHeight: 1.7 }}>
              {checks.filter((c) => c.status !== "PASS").map((c, idx) => (
                <li key={idx}>{c.plain || c.message}</li>
              ))}
            </ul>
          </div>
          {checks.some((c) => c.status !== "PASS" && c.canRebuildFix) && (
            <button
              onClick={handleRebuild}
              disabled={isBuilding}
              style={{ padding: "12px 22px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 14, cursor: isBuilding ? "wait" : "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(220, 38, 38, 0.25)" }}
            >
              {isBuilding ? "Fixing..." : "🔧 Fix This Now"}
            </button>
          )}
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
        <button
          onClick={() => setActiveTab("pricing")}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: activeTab === "pricing" ? "#0f172a" : "#f1f5f9",
            color: activeTab === "pricing" ? "#fff" : "#475569",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ⚖️ Daily Metal Rates & Matrix
        </button>
        <button
          onClick={() => setActiveTab("diagnostics")}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: activeTab === "diagnostics" ? "#0f172a" : "#f1f5f9",
            color: activeTab === "diagnostics" ? "#fff" : "#475569",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          🩺 Live System Diagnostics ({checks.length})
        </button>
        <button
          onClick={() => setActiveTab("troubleshooting")}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: activeTab === "troubleshooting" ? "#0f172a" : "#f1f5f9",
            color: activeTab === "troubleshooting" ? "#fff" : "#475569",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          🛠️ Troubleshooting & Issue Solver
        </button>
      </div>

      {/* Error Displays */}
      {matrixFetcher.data?.error && (
        <div style={{ marginBottom: 24 }}>
          <FriendlyError title="Matrix Sync Error" error={matrixFetcher.data.error} />
        </div>
      )}

      {/* TAB 1: Daily Metal Rates & Matrix Rebuild */}
      {activeTab === "pricing" && (
        <>
          {/* Target Product Summary Card */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
              <span>📦</span> Matrix Target Product
            </h2>
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Product Name</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Active Variants</th>
                    <th style={thStyle}>Catalog Matrix</th>
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
                      Rings, Pendants, Bracelets (All Metals × Designs)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily Metal Rates Form */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚖️</span> Daily Metal Rates & Pricing Formula
                </h2>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                  Enter current market rates per gram. Making charges and GST will be applied automatically to all 250+ variants.
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

            <div style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: 10, border: "1px solid #e2e8f0", marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                id="enableMakingChargeAndTax"
                checked={!!rates.enableMakingChargeAndTax}
                onChange={(e) => setRates((prev) => ({ ...prev, enableMakingChargeAndTax: e.target.checked }))}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <label htmlFor="enableMakingChargeAndTax" style={{ fontSize: 13, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                Apply Making Charge &amp; GST Tax to live pricing
              </label>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {rates.enableMakingChargeAndTax
                  ? "On — the making charge and tax rate above are added to customized pricing on the storefront."
                  : "Off — customized pricing uses metal cost only (making charge/tax above are saved but not applied)."}
              </span>
            </div>

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

          {/* Live Design Prices — the actual price each Type/Metal/Design
              combo is charging right now, straight off the real Shopify
              variants (not a recomputation) — refreshes after every
              Rebuild, so what's shown here is proof the click did
              something, not just a "success" toast. */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>💰</span> Live Design Prices
                </h2>
                <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                  What each design is actually charging right now, read straight off the live "Gemstone Customisation" variants.
                </p>
              </div>
              <select
                value={previewTypeFilter}
                onChange={(e) => setPreviewTypeFilter(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, color: "#334155" }}
              >
                <option value="all">All Types</option>
                {Array.from(new Set(preview.map((p) => p.type))).sort().map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {preview.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                No live variants yet — click "Save Rates & Rebuild Customisation Matrix" above to create and price them.
              </p>
            ) : (
              <div style={{ ...tableWrapStyle, maxHeight: 420, overflowY: "auto" }}>
                <table style={tableStyle}>
                  <thead style={{ position: "sticky", top: 0, background: "#fff" }}>
                    <tr>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Metal</th>
                      <th style={thStyle}>Design</th>
                      <th style={thStyle}>Live Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview
                      .filter((p) => previewTypeFilter === "all" || p.type === previewTypeFilter)
                      .map((p, idx) => (
                        <tr key={idx}>
                          <td style={tdStyle}>{p.type}</td>
                          <td style={tdStyle}>{p.metal}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{p.design}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: brand }}>
                            ₹{p.price.toLocaleString("en-IN")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB 2: Live System Diagnostics */}
      {activeTab === "diagnostics" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, marginBottom: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a" }}>
                🩺 Live Component Health Checks
              </h2>
              <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                Real-time verification of your product matrix, sales channels, and theme snippets.
              </p>
            </div>
            <button
              onClick={handleRunDiagnostics}
              disabled={isChecking}
              style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              {isChecking ? "Scanning..." : "↻ Re-run Checks"}
            </button>
          </div>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Component</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Live Details</th>
                  <th style={thStyle}>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check, idx) => (
                  <tr key={idx}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#0f172a" }}>
                      {check.name}
                    </td>
                    <td style={tdStyle}>
                      {check.status === "PASS" ? (
                        <Pill color="green">✓ PASS</Pill>
                      ) : check.status === "WARNING" ? (
                        <Pill color="amber">⚠️ WARNING</Pill>
                      ) : (
                        <Pill color="red">✕ ERROR</Pill>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "#334155", fontSize: 13 }}>
                      {check.message}
                    </td>
                    <td style={{ ...tdStyle, color: "#64748b", fontSize: 12 }}>
                      {check.resolution || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Troubleshooting & Issue Solver */}
      {activeTab === "troubleshooting" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Live, real issues -- built from the SAME diagnostics as the
              System Diagnostics tab, not a generic static list. This is
              what makes this tab "troubleshooting" rather than "reference
              docs": it tells you what's ACTUALLY wrong right now, if
              anything, using the exact checks that just ran. */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                <span>🩺</span> Active Issues Right Now
              </h2>
              <button
                onClick={handleRunDiagnostics}
                disabled={isChecking}
                style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
              >
                {isChecking ? "Scanning..." : "↻ Re-check"}
              </button>
            </div>
            <p style={{ margin: "4px 0 20px", color: "#64748b", fontSize: 13 }}>
              Pulled live from the same {checks.length} checks as the Diagnostics tab — not a fixed list.
            </p>

            {checks.filter((c) => c.status !== "PASS").length === 0 ? (
              <div style={{ padding: "14px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: 13, fontWeight: 600 }}>
                ✓ No active issues detected — all {checks.length} checks are passing.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {checks.filter((c) => c.status !== "PASS").map((c, idx) => (
                  <div key={idx} style={{ border: `1px solid ${c.status === "ERROR" ? "#fecaca" : "#fde68a"}`, borderRadius: 10, padding: 18, background: c.status === "ERROR" ? "#fef2f2" : "#fffbeb" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                          {c.status === "ERROR" ? "🔴" : "🟡"} {c.name}
                        </h3>
                        <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.5 }}>{c.message}</p>
                        {c.resolution && (
                          <p style={{ margin: "4px 0 0", color: "#059669", fontSize: 13, fontWeight: 600 }}>
                            <strong>How to solve:</strong> {c.resolution}
                          </p>
                        )}
                      </div>
                      {/matrix|variant|price/i.test(c.name) && (
                        <button
                          onClick={handleRebuild}
                          disabled={isBuilding}
                          style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#059669", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          🚀 1-Click Sync Matrix
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px", color: "#0f172a" }}>
            📖 Common Scenarios &amp; How to Fix Them
          </h2>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 13 }}>
            Reference guide for issues that don't always show up as a failed check above:
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Scenario 1 */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                    🔴 Error: "There was an error updating your cart (Cannot find variant / 422)"
                  </h3>
                  <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
                    <strong>Why it happens:</strong> Metal rates or variants were rebuilt, but the theme's cached variant lookup table was out of sync with Shopify.
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#059669", fontSize: 13, fontWeight: 600 }}>
                    <strong>How to solve:</strong> Click the green button below. The app will immediately sync all 250+ active variant IDs directly into your theme.
                  </p>
                </div>
                <button
                  onClick={handleRebuild}
                  disabled={isBuilding}
                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#059669", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  🚀 1-Click Sync Matrix
                </button>
              </div>
            </div>

            {/* Scenario 2 */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, background: "#f8fafc" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                  🟡 Issue: "Product types (Ring / Pendant / Bracelet) not responding to clicks"
                </h3>
                <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
                  <strong>Why it happens:</strong> Theme customizer snippet is missing or JavaScript was blocked.
                </p>
                <p style={{ margin: "4px 0 0", color: "#0284c7", fontSize: 13, fontWeight: 600 }}>
                  <strong>How to solve:</strong> Go to <em>Live System Diagnostics</em> tab & click <em>Run Full Diagnostics</em> to verify all 3 theme files are active.
                </p>
              </div>
            </div>

            {/* Scenario 3 */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, background: "#f8fafc" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                  🟢 Daily Market Updates: "Gold / Silver market rate changed today"
                </h3>
                <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
                  <strong>How to update:</strong> Go to <em>Daily Metal Rates</em> tab, type the new rates in the input boxes, and click <em>Save Rates & Rebuild Customisation Matrix</em>. All 250+ variants will update automatically in seconds!
                </p>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useLoaderData());
}
