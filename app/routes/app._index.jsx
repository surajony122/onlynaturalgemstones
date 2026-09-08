import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  fetchCustomisationStatus,
  buildGemstoneCustomisationMatrix,
  runFullSystemDiagnostics,
  fetchCustomisationVariantsPreview,
} from "../utils/gemstoneCustomisationMatrix.server";
import { getAppSettings, saveMetalRates, ratesFromAppSettings } from "../utils/appSettings.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, Pill, brand, Icon, Card, PageHeader, PageIn } from "../components/table-kit";
import { useToast } from "../components/toast";
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

// [key in the rates object, display label, unit prefix character]
const RATE_FIELDS = [
  ["silver", "Silver (per gram)", "₹"],
  ["22k-yellow", "22K Yellow Gold (per gram)", "₹"],
  ["18k-yellow", "18K Yellow Gold (per gram)", "₹"],
  ["18k-white", "18K White Gold (per gram)", "₹"],
  ["14k-yellow", "14K Yellow Gold (per gram)", "₹"],
  ["14k-white", "14K White Gold (per gram)", "₹"],
  ["panchdhatu", "Panchdhatu (per gram)", "₹"],
  ["copper", "Tamba / Copper (per gram)", "₹"],
  ["makingCharge", "Making Charges (per gram)", "₹"],
  ["taxRate", "Tax / GST Rate (%)", "%"],
];

function RateField({ label, unit, value, onChange }) {
  return (
    <div style={{ background: brand.panel, padding: "14px", borderRadius: "10px", border: `1px solid ${brand.divider}` }}>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: brand.muted, marginBottom: "6px" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: brand.muted, fontWeight: 600, fontFamily: brand.mono }}>{unit}</span>
        <input
          type="number"
          step="any"
          value={value || 0}
          onChange={onChange}
          style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: `1px solid ${brand.border}`, fontSize: "14px", fontWeight: 600, color: brand.ink, fontFamily: brand.mono }}
        />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: "9px",
        border: "none",
        background: active ? brand.ink : brand.panel,
        color: active ? "#fff" : brand.body,
        fontWeight: 600,
        fontSize: "13.5px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function Index() {
  const { shopDomain, customisationStatus: initialStatus, systemChecks: initialChecks, variantsPreview: initialPreview, defaultRates } = useLoaderData();
  const matrixFetcher = useFetcher();
  const diagFetcher = useFetcher();
  const toast = useToast();

  const [status, setStatus] = useState(initialStatus || {});
  const [checks, setChecks] = useState(initialChecks || []);
  const [preview, setPreview] = useState(initialPreview || []);
  const [previewTypeFilter, setPreviewTypeFilter] = useState("all");
  const [rates, setRates] = useState(defaultRates || {});
  const [activeTab, setActiveTab] = useState("pricing"); // "pricing" | "diagnostics" | "troubleshooting"

  const isBuilding = matrixFetcher.state === "submitting";
  const isChecking = diagFetcher.state === "submitting";

  useEffect(() => {
    if (matrixFetcher.data?.customisationStatus) setStatus(matrixFetcher.data.customisationStatus);
    if (matrixFetcher.data?.systemChecks) setChecks(matrixFetcher.data.systemChecks);
    if (matrixFetcher.data?.preview) setPreview(matrixFetcher.data.preview);
    if (matrixFetcher.data?.ok) {
      toast.show(`Successfully synced ${matrixFetcher.data.totalVariants || 0} customization variants!`);
    } else if (matrixFetcher.data?.error) {
      toast.show(`Error: ${matrixFetcher.data.error}`, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixFetcher.data]);

  useEffect(() => {
    if (diagFetcher.data?.customisationStatus) setStatus(diagFetcher.data.customisationStatus);
    if (diagFetcher.data?.systemChecks) {
      setChecks(diagFetcher.data.systemChecks);
      toast.show("Diagnostics completed!");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagFetcher.data]);

  const handleRateChange = (key, value) => {
    setRates((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleRebuild = () => {
    matrixFetcher.submit({ intent: "rebuildCustomisationMatrix", rates: JSON.stringify(rates) }, { method: "post" });
  };

  const handleRunDiagnostics = () => {
    diagFetcher.submit({ intent: "runDiagnostics" }, { method: "post" });
  };

  const allPassed = checks.length > 0 && checks.every((c) => c.status === "PASS");
  const failingChecks = checks.filter((c) => c.status !== "PASS");

  return (
    <PageIn>
      <PageHeader title="Jewelry Pricing" description="Daily metal rates, live health, and the customisation matrix they price — in one place." />

      {/* Status hero banner */}
      <div style={{ background: `linear-gradient(135deg, ${brand.ink} 0%, #322A47 100%)`, color: "#fff", padding: "24px 28px", borderRadius: "14px", marginBottom: "20px", boxShadow: brand.lift }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.12)", padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "10px" }}>
              <Icon name="diamond" size={13} /> Gemstone Customisation
            </div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em" }}>Command center for {shopDomain}</h2>
          </div>
          <button
            onClick={handleRunDiagnostics}
            disabled={isChecking || isBuilding}
            style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "#fff", fontWeight: 600, fontSize: "13px", cursor: isChecking ? "wait" : "pointer", display: "flex", alignItems: "center", gap: "7px" }}
          >
            <Icon name="activity" size={14} color="#fff" style={{ animation: isChecking ? "ongSpin 0.8s linear infinite" : "none" }} />
            {isChecking ? "Checking…" : "Run Full Diagnostics"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "18px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.14)" }}>
          <div style={{ background: "rgba(255,255,255,0.08)", padding: "6px 12px", borderRadius: "8px", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: status.found ? "#4ADE80" : "#FACC15" }} />
            <span>Target: <strong>Gemstone Customisation</strong> ({status.totalVariants || 0} variants)</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", padding: "6px 12px", borderRadius: "8px", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: allPassed ? "#4ADE80" : "#7DD3FC" }} />
            <span>System Health: <strong>{allPassed ? "All Systems Operational" : "Healthy"}</strong></span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", padding: "6px 12px", borderRadius: "8px", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <Icon name="cart" size={13} color="#fff" />
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
      {failingChecks.length > 0 && (
        <Card style={{ marginBottom: "20px", border: `2px solid ${brand.dangerLine}`, background: brand.dangerBg, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14.5px", fontWeight: 700, color: brand.danger, marginBottom: "6px" }}>
              <Icon name="alert" size={16} color={brand.danger} />
              {failingChecks.length === 1 ? "1 issue needs" : `${failingChecks.length} issues need`} your attention
            </div>
            <ul style={{ margin: 0, paddingLeft: "20px", color: brand.body, fontSize: "13px", lineHeight: 1.7 }}>
              {failingChecks.map((c, idx) => (
                <li key={idx}>{c.plain || c.message}</li>
              ))}
            </ul>
          </div>
          {checks.some((c) => c.status !== "PASS" && c.canRebuildFix) && (
            <button
              onClick={handleRebuild}
              disabled={isBuilding}
              style={{ padding: "12px 22px", borderRadius: "9px", border: "none", background: brand.danger, color: "#fff", fontWeight: 700, fontSize: "14px", cursor: isBuilding ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {isBuilding ? "Fixing…" : "Fix This Now"}
            </button>
          )}
        </Card>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", borderBottom: `1px solid ${brand.border}`, paddingBottom: "12px" }}>
        <TabButton active={activeTab === "pricing"} onClick={() => setActiveTab("pricing")}>Daily Metal Rates &amp; Matrix</TabButton>
        <TabButton active={activeTab === "diagnostics"} onClick={() => setActiveTab("diagnostics")}>Live System Diagnostics ({checks.length})</TabButton>
        <TabButton active={activeTab === "troubleshooting"} onClick={() => setActiveTab("troubleshooting")}>Troubleshooting &amp; Issue Solver</TabButton>
      </div>

      {matrixFetcher.data?.error && (
        <div style={{ marginBottom: "24px" }}>
          <FriendlyError title="Matrix Sync Error" error={matrixFetcher.data.error} />
        </div>
      )}

      {/* TAB 1: Daily Metal Rates & Matrix Rebuild */}
      {activeTab === "pricing" && (
        <>
          <Card style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px", color: brand.ink, display: "flex", alignItems: "center", gap: "8px" }}>
              <Icon name="package" size={16} color={brand.ink} /> Matrix Target Product
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
                    <td style={{ ...tdStyle, fontWeight: 600, color: brand.ink }}>{status.title || "Gemstone Customisation"}</td>
                    <td style={tdStyle}>
                      {status.found ? <Pill label="Active in Store" active color={brand.success} /> : <Pill label="Ready to Create" active color={brand.warn} />}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700, fontSize: "14px", color: brand.accent }}>{status.totalVariants || 0} variants</td>
                    <td style={{ ...tdStyle, color: brand.muted, fontSize: "13px" }}>Rings, Pendants, Bracelets (All Metals × Designs)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 4px", color: brand.ink }}>Daily Metal Rates &amp; Pricing Formula</h2>
            <p style={{ margin: "0 0 20px", color: brand.muted, fontSize: "13px" }}>
              Enter current market rates per gram. Making charges and GST will be applied automatically to all
              {status.totalVariants ? ` ${status.totalVariants}+` : ""} variants.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
              {RATE_FIELDS.map(([key, label, unit]) => (
                <RateField key={key} label={label} unit={unit} value={rates[key]} onChange={(e) => handleRateChange(key, e.target.value)} />
              ))}
            </div>

            <div style={{ background: brand.panel, padding: "14px 16px", borderRadius: "10px", border: `1px solid ${brand.divider}`, marginBottom: "18px", display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="checkbox"
                id="enableMakingChargeAndTax"
                checked={!!rates.enableMakingChargeAndTax}
                onChange={(e) => setRates((prev) => ({ ...prev, enableMakingChargeAndTax: e.target.checked }))}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              <label htmlFor="enableMakingChargeAndTax" style={{ fontSize: "13px", fontWeight: 600, color: brand.body, cursor: "pointer" }}>
                Apply Making Charge &amp; GST Tax to live pricing
              </label>
              <span style={{ fontSize: "12px", color: brand.faint }}>
                {rates.enableMakingChargeAndTax
                  ? "On — the making charge and tax rate above are added to customized pricing on the storefront."
                  : "Off — customized pricing uses metal cost only (making charge/tax above are saved but not applied)."}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: `1px solid ${brand.divider}`, paddingTop: "18px" }}>
              <button
                onClick={handleRebuild}
                disabled={isBuilding}
                style={{ padding: "12px 24px", borderRadius: "9px", border: "none", background: isBuilding ? brand.faint : brand.accent, color: "#fff", fontWeight: 700, fontSize: "14px", cursor: isBuilding ? "wait" : "pointer", display: "flex", alignItems: "center", gap: "8px" }}
              >
                {isBuilding ? (
                  <>
                    <Icon name="refresh" size={14} color="#fff" style={{ animation: "ongSpin 0.6s linear infinite" }} />
                    Calculating &amp; Syncing Matrix…
                  </>
                ) : (
                  <>
                    <Icon name="refresh" size={14} color="#fff" />
                    Save Rates &amp; Rebuild Customisation Matrix
                  </>
                )}
              </button>
            </div>
          </Card>

          {/* Live Design Prices — the actual price each Type/Metal/Design
              combo is charging right now, straight off the real Shopify
              variants (not a recomputation) — refreshes after every
              Rebuild, so what's shown here is proof the click did
              something, not just a "success" toast. */}
          <Card style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: brand.ink }}>Live Design Prices</h2>
                <p style={{ margin: "4px 0 0", color: brand.muted, fontSize: "13px" }}>What each design is actually charging right now, read straight off the live "Gemstone Customisation" variants.</p>
              </div>
              <select
                value={previewTypeFilter}
                onChange={(e) => setPreviewTypeFilter(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: "8px", border: `1px solid ${brand.border}`, fontSize: "13px", fontWeight: 600, color: brand.body }}
              >
                <option value="all">All Types</option>
                {Array.from(new Set(preview.map((p) => p.type))).sort().map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {preview.length === 0 ? (
              <p style={{ color: brand.faint, fontSize: "13px", margin: 0 }}>
                No live variants yet — click "Save Rates &amp; Rebuild Customisation Matrix" above to create and price them.
              </p>
            ) : (
              <div style={{ ...tableWrapStyle, maxHeight: "420px", overflowY: "auto" }}>
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
                          <td style={{ ...tdStyle, fontWeight: 700, color: brand.accent, fontFamily: brand.mono }}>₹{p.price.toLocaleString("en-IN")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* TAB 2: Live System Diagnostics */}
      {activeTab === "diagnostics" && (
        <Card style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: brand.ink }}>Live Component Health Checks</h2>
              <p style={{ margin: "4px 0 0", color: brand.muted, fontSize: "13px" }}>Real-time verification of your product matrix, sales channels, and theme snippets.</p>
            </div>
            <button onClick={handleRunDiagnostics} disabled={isChecking} style={{ padding: "8px 14px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: brand.panel, fontWeight: 600, fontSize: "13px", cursor: "pointer", color: brand.body }}>
              {isChecking ? "Scanning…" : "↻ Re-run Checks"}
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
                    <td style={{ ...tdStyle, fontWeight: 600, color: brand.ink }}>{check.name}</td>
                    <td style={tdStyle}>
                      {check.status === "PASS" ? (
                        <Pill label="PASS" active color={brand.success} />
                      ) : check.status === "WARNING" ? (
                        <Pill label="WARNING" active color={brand.warn} />
                      ) : (
                        <Pill label="ERROR" active color={brand.danger} />
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: brand.body, fontSize: "13px" }}>{check.message}</td>
                    <td style={{ ...tdStyle, color: brand.muted, fontSize: "12px" }}>{check.resolution || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: Troubleshooting & Issue Solver */}
      {activeTab === "troubleshooting" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Live, real issues -- built from the SAME diagnostics as the
              System Diagnostics tab, not a generic static list. */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "12px" }}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: brand.ink, display: "flex", alignItems: "center", gap: "8px" }}>
                <Icon name="activity" size={16} color={brand.ink} /> Active Issues Right Now
              </h2>
              <button onClick={handleRunDiagnostics} disabled={isChecking} style={{ padding: "7px 12px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: brand.panel, fontWeight: 600, fontSize: "12px", cursor: "pointer", color: brand.body }}>
                {isChecking ? "Scanning…" : "↻ Re-check"}
              </button>
            </div>
            <p style={{ margin: "4px 0 20px", color: brand.muted, fontSize: "13px" }}>Pulled live from the same {checks.length} checks as the Diagnostics tab — not a fixed list.</p>

            {failingChecks.length === 0 ? (
              <div style={{ padding: "14px 16px", borderRadius: "10px", background: brand.successBg, border: `1px solid ${brand.successLine}`, color: brand.success, fontSize: "13px", fontWeight: 600 }}>
                ✓ No active issues detected — all {checks.length} checks are passing.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {failingChecks.map((c, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: `1px solid ${c.status === "ERROR" ? brand.dangerLine : brand.warnLine}`,
                      borderRadius: "10px",
                      padding: "18px",
                      background: c.status === "ERROR" ? brand.dangerBg : brand.warnBg,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: brand.ink, display: "flex", alignItems: "center", gap: "6px" }}>
                          <Icon name={c.status === "ERROR" ? "x-circle" : "alert"} size={14} color={c.status === "ERROR" ? brand.danger : brand.warn} />
                          {c.name}
                        </h3>
                        <p style={{ margin: "6px 0 0", color: brand.body, fontSize: "13px", lineHeight: 1.5 }}>{c.message}</p>
                        {c.resolution && (
                          <p style={{ margin: "4px 0 0", color: brand.success, fontSize: "13px", fontWeight: 600 }}>
                            <strong>How to solve:</strong> {c.resolution}
                          </p>
                        )}
                      </div>
                      {/matrix|variant|price/i.test(c.name) && (
                        <button onClick={handleRebuild} disabled={isBuilding} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: brand.success, color: "#fff", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" }}>
                          1-Click Sync Matrix
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px", color: brand.ink }}>Common Scenarios &amp; How to Fix Them</h2>
            <p style={{ margin: "0 0 20px", color: brand.muted, fontSize: "13px" }}>Reference guide for issues that don't always show up as a failed check above:</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", padding: "18px", background: brand.panel }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: brand.ink }}>
                      Error: "There was an error updating your cart (Cannot find variant / 422)"
                    </h3>
                    <p style={{ margin: "6px 0 0", color: brand.body, fontSize: "13px", lineHeight: 1.5 }}>
                      <strong>Why it happens:</strong> Metal rates or variants were rebuilt, but the theme's cached
                      variant lookup table was out of sync with Shopify.
                    </p>
                    <p style={{ margin: "4px 0 0", color: brand.success, fontSize: "13px", fontWeight: 600 }}>
                      <strong>How to solve:</strong> Click the button below. The app will immediately sync all
                      active variant IDs directly into your theme.
                    </p>
                  </div>
                  <button onClick={handleRebuild} disabled={isBuilding} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: brand.success, color: "#fff", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" }}>
                    1-Click Sync Matrix
                  </button>
                </div>
              </div>

              <div style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", padding: "18px", background: brand.panel }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: brand.ink }}>Issue: "Product types (Ring / Pendant / Bracelet) not responding to clicks"</h3>
                <p style={{ margin: "6px 0 0", color: brand.body, fontSize: "13px", lineHeight: 1.5 }}>
                  <strong>Why it happens:</strong> Theme customizer snippet is missing or JavaScript was blocked.
                </p>
                <p style={{ margin: "4px 0 0", color: brand.accent, fontSize: "13px", fontWeight: 600 }}>
                  <strong>How to solve:</strong> Go to <em>Live System Diagnostics</em> tab &amp; click{" "}
                  <em>Run Full Diagnostics</em> to verify all theme files are active.
                </p>
              </div>

              <div style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", padding: "18px", background: brand.panel }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: brand.ink }}>Daily Market Updates: "Gold / Silver market rate changed today"</h3>
                <p style={{ margin: "6px 0 0", color: brand.body, fontSize: "13px", lineHeight: 1.5 }}>
                  <strong>How to update:</strong> Go to <em>Daily Metal Rates</em> tab, type the new rates in the
                  input boxes, and click <em>Save Rates &amp; Rebuild Customisation Matrix</em>. All variants will
                  update automatically in seconds!
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </PageIn>
  );
}

export function ErrorBoundary() {
  return boundary.error(useLoaderData());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
