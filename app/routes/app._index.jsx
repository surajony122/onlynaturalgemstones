import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { findLiveThemeId, inspectThemeCustomizerFiles, listThemes } from "../utils/shopify-admin.server";
import { buildSettingsDesignMatrix, fetchSettingsProductsStatus } from "../utils/settingsMatrix.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill, brand } from "../components/table-kit";
import { FriendlyError, FriendlyErrorInline } from "../components/friendly-error";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let settingsProducts = [];
  try {
    settingsProducts = await fetchSettingsProductsStatus(admin);
  } catch (err) {
    console.error("[app._index] loader fetchSettingsProductsStatus error:", err);
  }

  return {
    shopDomain: (session.shop || "").replace(".myshopify.com", ""),
    settingsProducts,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "refreshProducts") {
    try {
      const customTitles = JSON.parse(formData.get("customTitles") || "{}");
      const products = await fetchSettingsProductsStatus(admin, customTitles);
      return { intent, ok: true, products };
    } catch (err) {
      console.error("[app._index] refreshProducts failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "buildSettingsMatrix") {
    try {
      const targets = JSON.parse(formData.get("targets") || "{}");
      const result = await buildSettingsDesignMatrix(admin, targets);
      const updatedProducts = await fetchSettingsProductsStatus(admin, targets);
      return { intent, ok: true, ...result, updatedProducts };
    } catch (err) {
      console.error("[app._index] buildSettingsMatrix failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "listThemes") {
    try {
      const themes = await listThemes(admin);
      return { intent, ok: true, themes };
    } catch (err) {
      console.error("[app._index] listThemes failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "inspectTheme") {
    try {
      const themeId = formData.get("themeId");
      const themeName = formData.get("themeName");
      const theme = themeId ? { id: themeId, name: themeName || themeId } : await findLiveThemeId(admin);
      const result = await inspectThemeCustomizerFiles(admin, theme.id);
      return { intent, ok: true, theme, ...result };
    } catch (err) {
      console.error("[app._index] inspectTheme failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  return { ok: false, error: "Unknown intent" };
};

export default function Index() {
  const { shopDomain, settingsProducts: initialProducts } = useLoaderData();
  const settingsMatrixFetcher = useFetcher();
  const refreshFetcher = useFetcher();
  const themeFetcher = useFetcher();
  const themeListFetcher = useFetcher();
  const shopify = useAppBridge();

  const [productsList, setProductsList] = useState(initialProducts || []);
  const [selectedTypes, setSelectedTypes] = useState({ ring: true, pendant: true, bracelet: true });
  const [productTitles, setProductTitles] = useState({
    ring: "Ring Settings",
    pendant: "Pendant Settings",
    bracelet: "Bracelet Settings",
  });
  const [selectedThemeId, setSelectedThemeId] = useState("");

  const isBuilding = settingsMatrixFetcher.state === "submitting";
  const isRefreshing = refreshFetcher.state === "submitting";
  const isListingThemes = themeListFetcher.state === "submitting";
  const isInspectingTheme = themeFetcher.state === "submitting";

  // Sync products when action completes
  useEffect(() => {
    if (settingsMatrixFetcher.data?.intent === "buildSettingsMatrix") {
      if (settingsMatrixFetcher.data.ok) {
        shopify.toast.show("Settings design matrix rebuilt successfully!");
        if (settingsMatrixFetcher.data.updatedProducts) {
          setProductsList(settingsMatrixFetcher.data.updatedProducts);
        }
      } else {
        shopify.toast.show(settingsMatrixFetcher.data.error || "Failed to rebuild matrix", { isError: true });
      }
    }
  }, [settingsMatrixFetcher.data, shopify]);

  useEffect(() => {
    if (refreshFetcher.data?.intent === "refreshProducts" && refreshFetcher.data.ok) {
      setProductsList(refreshFetcher.data.products);
      shopify.toast.show("Product status refreshed");
    }
  }, [refreshFetcher.data, shopify]);

  const handleToggleType = (type) => {
    setSelectedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const handleTitleChange = (type, val) => {
    setProductTitles((prev) => ({ ...prev, [type]: val }));
  };

  const handleRefresh = () => {
    refreshFetcher.submit(
      { intent: "refreshProducts", customTitles: JSON.stringify(productTitles) },
      { method: "POST" }
    );
  };

  const handleRebuild = () => {
    const targets = {};
    Object.keys(selectedTypes).forEach((type) => {
      if (selectedTypes[type]) {
        targets[type] = productTitles[type] || "Settings";
      }
    });

    if (Object.keys(targets).length === 0) {
      shopify.toast.show("Please select at least one supporting setting product.", { isError: true });
      return;
    }

    settingsMatrixFetcher.submit(
      { intent: "buildSettingsMatrix", targets: JSON.stringify(targets) },
      { method: "POST" }
    );
  };

  const listThemesForInspector = () => themeListFetcher.submit({ intent: "listThemes" }, { method: "POST" });
  const inspectTheme = () => {
    const selected = (themeListFetcher.data?.themes || []).find((t) => t.id === selectedThemeId);
    themeFetcher.submit(
      selected ? { intent: "inspectTheme", themeId: selected.id, themeName: selected.name } : { intent: "inspectTheme" },
      { method: "POST" }
    );
  };

  return (
    <s-page heading="Jewelry Settings Design Matrix">
      <TableGlobalStyles />

      {/* Main Settings Product Matrix Manager */}
      <s-section heading="Supporting Setting Products (Ring, Pendant, Bracelet)">
        <s-paragraph>
          This manager builds and updates the pre-priced <strong>Metal &times; Design</strong> variant matrix on your 3
          supporting setting products. <strong>Leaves all gemstone products 100% untouched.</strong>
        </s-paragraph>

        <div style={{ marginTop: "16px", ...tableWrapStyle }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: "45px", textAlign: "center" }}>Select</th>
                <th style={{ ...thStyle, width: "110px" }}>Type</th>
                <th style={thStyle}>Shopify Product Title</th>
                <th style={{ ...thStyle, width: "140px" }}>Status</th>
                <th style={thStyle}>Metals Detected</th>
                <th style={{ ...thStyle, width: "90px", textAlign: "right" }}>Variants</th>
              </tr>
            </thead>
            <tbody>
              {productsList.map((item) => {
                const isChecked = !!selectedTypes[item.type];
                const titleVal = productTitles[item.type] || item.title;

                return (
                  <tr key={item.type}>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleType(item.type)}
                        style={{ cursor: "pointer", width: "16px", height: "16px" }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          fontSize: "11.5px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          background: brand.panel,
                          color: brand.body,
                          border: `1px solid ${brand.border}`,
                        }}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={titleVal}
                        onChange={(e) => handleTitleChange(item.type, e.target.value)}
                        placeholder="Product title in Shopify"
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          fontSize: "13px",
                          borderRadius: "6px",
                          border: `1px solid ${brand.border}`,
                          background: "#fff",
                        }}
                      />
                    </td>
                    <td style={tdStyle}>
                      {item.found ? (
                        <Pill label="✓ Found in Store" active color={brand.success} />
                      ) : (
                        <Pill label="⚠ Not Found" active color={brand.danger} />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: "12px", color: brand.muted }}>
                        {item.metals && item.metals.length > 0 ? item.metals.join(", ") : "None detected"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                      {item.totalVariants || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "16px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <s-button
            tone="critical"
            variant="primary"
            {...(isBuilding ? { loading: true } : {})}
            onClick={handleRebuild}
          >
            Rebuild Matrix on Selected Products
          </s-button>

          <s-button {...(isRefreshing ? { loading: true } : {})} onClick={handleRefresh}>
            Check / Refresh Status
          </s-button>
        </div>

        {settingsMatrixFetcher.data?.intent === "buildSettingsMatrix" && !settingsMatrixFetcher.data.ok && (
          <div style={{ marginTop: "14px" }}>
            <FriendlyError
              message="Couldn't rebuild the settings design matrix."
              detail={settingsMatrixFetcher.data.error}
            />
          </div>
        )}

        {settingsMatrixFetcher.data?.intent === "buildSettingsMatrix" && settingsMatrixFetcher.data.ok && (
          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {(settingsMatrixFetcher.data.results || []).map((r) => (
              <div key={r.type} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {r.ok ? (
                  <Pill label={`✓ ${r.title}: ${r.variantCount} variants updated`} active color={brand.success} />
                ) : (
                  <FriendlyErrorInline message={`${r.title} failed`} detail={r.error} />
                )}
              </div>
            ))}
          </div>
        )}
      </s-section>

      {/* Inspect storefront customizer Section */}
      <s-section heading="Theme Customizer Inspector (Diagnostic)">
        <s-paragraph>
          Scan any theme's Liquid and JS files to inspect customizer configurations and verify storefront scripts.
        </s-paragraph>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <s-button {...(isListingThemes ? { loading: true } : {})} onClick={listThemesForInspector}>
            List themes
          </s-button>
          {themeListFetcher.data?.ok && (themeListFetcher.data.themes || []).length > 0 && (
            <select
              value={selectedThemeId}
              onChange={(e) => setSelectedThemeId(e.target.value)}
              style={{
                padding: "6px 10px",
                fontSize: "13px",
                borderRadius: "6px",
                border: `1px solid ${brand.border}`,
                background: "#fff",
              }}
            >
              <option value="">-- Live theme (default) --</option>
              {themeListFetcher.data.themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.role === "MAIN" ? "(live)" : `(${t.role.toLowerCase()})`}
                </option>
              ))}
            </select>
          )}
          <s-button {...(isInspectingTheme ? { loading: true } : {})} onClick={inspectTheme}>
            Inspect theme files
          </s-button>
        </div>

        {themeFetcher.data?.intent === "inspectTheme" && themeFetcher.data.ok && (
          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <p style={{ fontSize: "12.5px", color: brand.muted, margin: 0 }}>
              Theme: <s-text fontWeight="bold">{themeFetcher.data.theme?.name}</s-text> ·{" "}
              {themeFetcher.data.totalFilesScanned} files scanned · {themeFetcher.data.candidateCount} matched
            </p>
            {themeFetcher.data.candidates?.length > 0 && (
              <p style={{ fontSize: "12px", color: brand.body, margin: 0 }}>
                Matching files: {themeFetcher.data.candidates.join(", ")}
              </p>
            )}
            {(themeFetcher.data.contents || []).map((f) => (
              <div key={f.filename} style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", padding: "10px" }}>
                <p style={{ fontSize: "12.5px", fontWeight: 600, color: brand.body, margin: "0 0 6px" }}>
                  {f.filename} ({f.length.toLocaleString()} chars{f.length > 3000 ? ", showing first 3,000" : ""})
                </p>
                {f.excerpt && (
                  <pre
                    style={{
                      fontSize: "11px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: "260px",
                      overflow: "auto",
                      background: brand.panel,
                      padding: "8px",
                      borderRadius: "6px",
                      margin: 0,
                    }}
                  >
                    {f.excerpt}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error();
}
