import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  repriceDesignVariants,
  findProductsMissingJewelrySetup,
  setupJewelryVariantsForProducts,
  SETUP_BATCH_SIZE,
  PRODUCT_ID_NUMERIC,
} from "../utils/repriceDesignVariants.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill } from "../components/table-kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // PRODUCT_ID_NUMERIC/SETUP_BATCH_SIZE live in a .server.js file — React
  // Router strips server-only modules from the client bundle, so a
  // component can't import them directly for use in JSX (that broke the
  // build). Returning them from the loader and reading them via
  // useLoaderData is the server -> client handoff React Router supports.
  return {
    productId: PRODUCT_ID_NUMERIC,
    setupBatchSize: SETUP_BATCH_SIZE,
    // .myshopify.com domain minus the suffix — matches the path segment
    // admin.shopify.com/store/<this> uses for deep links to a product.
    shopDomain: (session.shop || "").replace(".myshopify.com", ""),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "scanSetup") {
    try {
      const result = await findProductsMissingJewelrySetup(admin);
      return { intent, ok: true, ...result };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "setupSelected") {
    try {
      const productGids = JSON.parse(formData.get("productGids") || "[]");
      if (!Array.isArray(productGids) || !productGids.length) {
        return { intent, ok: false, error: "Check at least one product first." };
      }
      const result = await setupJewelryVariantsForProducts(admin, productGids);
      return { intent, ok: true, ...result };
    } catch (err) {
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  try {
    const result = await repriceDesignVariants(admin);
    return { intent: "reprice", ok: true, ...result };
  } catch (err) {
    return { intent: "reprice", ok: false, error: String(err.message || err) };
  }
};

export default function Index() {
  const { productId, shopDomain, setupBatchSize } = useLoaderData();
  const fetcher = useFetcher();
  const scanFetcher = useFetcher();
  const setupFetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isScanning = scanFetcher.state !== "idle";
  const isSettingUp = setupFetcher.state !== "idle";

  // Local copy of the "missing setup" list so a successful batch can
  // optimistically remove the products it just handled, without forcing a
  // full re-scan to see progress — synced from scanFetcher's result
  // whenever a fresh scan comes back.
  const [missing, setMissing] = useState([]);
  const [checked, setChecked] = useState(() => new Set());

  useEffect(() => {
    if (scanFetcher.data?.intent === "scanSetup" && scanFetcher.data.ok) {
      setMissing(scanFetcher.data.missing);
      setChecked(new Set());
    }
  }, [scanFetcher.data]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(`Repriced ${fetcher.data.variantCount} variants`);
    } else if (fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (scanFetcher.data?.intent === "scanSetup" && !scanFetcher.data.ok) {
      shopify.toast.show(scanFetcher.data.error, { isError: true });
    }
  }, [scanFetcher.data, shopify]);

  useEffect(() => {
    if (setupFetcher.data?.intent !== "setupSelected") return;
    if (!setupFetcher.data.ok) {
      shopify.toast.show(setupFetcher.data.error, { isError: true });
      return;
    }
    const succeededGids = new Set(
      setupFetcher.data.results.filter((r) => r.ok).map((r) => r.productGid)
    );
    setMissing((prev) => prev.filter((p) => !succeededGids.has(p.id)));
    setChecked((prev) => {
      const next = new Set(prev);
      succeededGids.forEach((gid) => next.delete(gid));
      return next;
    });
    const failCount = setupFetcher.data.results.length - succeededGids.size;
    shopify.toast.show(
      `Set up ${succeededGids.size} product${succeededGids.size === 1 ? "" : "s"}` +
        (failCount ? ` · ${failCount} failed (see table)` : "") +
        (setupFetcher.data.skipped ? ` · ${setupFetcher.data.skipped} more selected — click Apply again` : ""),
      { isError: failCount > 0 && succeededGids.size === 0 }
    );
  }, [setupFetcher.data, shopify]);

  const reprice = () => fetcher.submit({}, { method: "POST" });
  const scanSetup = () => scanFetcher.submit({ intent: "scanSetup" }, { method: "POST" });

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const checkAllMissing = () => setChecked(new Set(missing.map((p) => p.id)));
  const clearChecked = () => setChecked(new Set());
  const applySetup = () => {
    setupFetcher.submit(
      { intent: "setupSelected", productGids: JSON.stringify([...checked]) },
      { method: "POST" }
    );
  };

  const resultByGid = Object.fromEntries(
    (setupFetcher.data?.intent === "setupSelected" ? setupFetcher.data.results : []).map((r) => [r.productGid, r])
  );

  return (
    <s-page heading="Shubh Gems — Jewelry Pricing">
      <s-button
        slot="primary-action"
        onClick={reprice}
        {...(isLoading ? { loading: true } : {})}
      >
        Reprice Design Variants
      </s-button>

      <s-section heading="What this does">
        <s-paragraph>
          The "test" gemstone's Ring/Bracelet/Pendant × Metal × Design
          variants each carry a real, baked-in price (stone price +
          setting/design cost). Prices don't update themselves when metal
          rates change in your theme settings — click the button above
          whenever you update a rate, and every affected variant gets
          recomputed and pushed to Shopify in one shot.
        </s-paragraph>
        <s-paragraph>
          Price formula per variant: <s-text>stone's own price</s-text> +
          either the design's explicit catalog price, or{" "}
          <s-text>weight × (metal rate + making charge)</s-text> when no
          explicit price is set for that design.
        </s-paragraph>
        <s-paragraph>
          Which designs (and which Types) a product gets depends on its assigned template —{" "}
          <s-text>product.pearl.json</s-text> gets the pearl design catalog, which only has Ring and Pendent (no
          Bracelet at all — pearls just don't come as bracelets). Every other product uses the default catalog with
          all three: Ring, Bracelet, Pendent.
        </s-paragraph>
      </s-section>

      {fetcher.data?.ok && (
        <s-section heading="Last run">
          <s-paragraph>
            Stone price used: ₹{fetcher.data.stonePrice} · Design set: {fetcher.data.designSet} · Variants updated:{" "}
            {fetcher.data.variantCount} · Design values:{" "}
            {fetcher.data.designValueCount}
          </s-paragraph>
        </s-section>
      )}
      {fetcher.data && !fetcher.data.ok && (
        <s-section heading="Last run failed">
          <s-paragraph>
            <s-text>{fetcher.data.error}</s-text>
          </s-paragraph>
        </s-section>
      )}

      <s-section heading="Products missing customizer setup">
        <s-paragraph>
          Scans every product in the store for the Type(Customised)/Metal option structure the jewelry customizer
          flow (and this Reprice tool) needs — the same check{" "}
          <s-text>snippets/shubh-jewelry-flow.liquid</s-text> itself uses to decide whether to render at all.
          Products listed below don't have it set up yet. Check the ones you want, then Apply — each selected
          product gets the same Metal × Design matrix <s-text>Reprice Design Variants</s-text> above builds for the
          "test" product, using <s-text>that product's own current price</s-text> as the base stone price (its
          single existing variant if it doesn't have a "Loose" one yet). Products on the{" "}
          <s-text>product.pearl.json</s-text> template automatically get Ring/Pendent only (no Bracelet); everything
          else gets Ring/Bracelet/Pendent.
        </s-paragraph>
        <s-button {...(isScanning ? { loading: true } : {})} onClick={scanSetup}>
          Scan Products
        </s-button>

        {scanFetcher.data?.intent === "scanSetup" && scanFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <p style={{ fontSize: "13px", color: "#6d7175", margin: "0 0 10px" }}>
              Scanned {scanFetcher.data.scanned} product{scanFetcher.data.scanned === 1 ? "" : "s"} ·{" "}
              {missing.length} missing setup
              {scanFetcher.data.truncated ? " · stopped early (catalog larger than the scan's safety cap — rerun to continue)" : ""}
            </p>
            {missing.length === 0 ? (
              <s-paragraph>Every product in the store has this set up. Nothing to do.</s-paragraph>
            ) : (
              <>
                <div style={{ display: "flex", gap: "10px", margin: "0 0 12px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={checkAllMissing}
                    style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }}
                  >
                    Check all missing ({missing.length})
                  </button>
                  <button
                    type="button"
                    onClick={clearChecked}
                    style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }}
                  >
                    Clear selection
                  </button>
                  <s-button {...(isSettingUp ? { loading: true } : {})} onClick={applySetup}>
                    Apply setup to {checked.size} selected
                  </s-button>
                  <span style={{ fontSize: "12px", color: "#6d7175" }}>
                    Processes up to {setupBatchSize} per click — click Apply again for the rest of a larger
                    selection.
                  </span>
                </div>
                <TableGlobalStyles />
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}></th>
                        <th style={thStyle}>Title</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Handle</th>
                        <th style={thStyle}>Last result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missing.map((p) => {
                        const result = resultByGid[p.id];
                        return (
                          <tr key={p.id} className="dt-row">
                            <td style={tdStyle}>
                              <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                            </td>
                            <td style={tdStyle}>
                              <a
                                href={`https://admin.shopify.com/store/${shopDomain}/products/${p.numericId}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#2c6ecb" }}
                              >
                                {p.title}
                              </a>
                            </td>
                            <td style={tdStyle}>{p.status}</td>
                            <td style={tdStyle}>{p.handle}</td>
                            <td style={tdStyle}>
                              {result ? (
                                result.ok ? (
                                  <Pill
                                    label={`✓ ${result.variantCount} variants (${result.designSet})`}
                                    active
                                    color="#008060"
                                  />
                                ) : (
                                  <span style={{ color: "#d82c0d", fontSize: "12px" }}>{result.error}</span>
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="Product">
        <s-paragraph>
          Numeric ID: <s-text>{productId}</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
