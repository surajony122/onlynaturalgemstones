import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { repriceDesignVariants, findProductsMissingJewelrySetup, PRODUCT_ID_NUMERIC } from "../utils/repriceDesignVariants.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // PRODUCT_ID_NUMERIC lives in a .server.js file — React Router strips
  // server-only modules from the client bundle, so a component can't
  // import it directly for use in JSX (that broke the build). Returning
  // it from the loader and reading it via useLoaderData is the
  // server -> client handoff React Router actually supports.
  return {
    productId: PRODUCT_ID_NUMERIC,
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

  try {
    const result = await repriceDesignVariants(admin);
    return { intent: "reprice", ok: true, ...result };
  } catch (err) {
    return { intent: "reprice", ok: false, error: String(err.message || err) };
  }
};

const th = { textAlign: "left", padding: "6px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const td = { padding: "6px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", verticalAlign: "top" };

export default function Index() {
  const { productId, shopDomain } = useLoaderData();
  const fetcher = useFetcher();
  const scanFetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isScanning = scanFetcher.state !== "idle";

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

  const reprice = () => fetcher.submit({}, { method: "POST" });
  const scanSetup = () => scanFetcher.submit({ intent: "scanSetup" }, { method: "POST" });

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
      </s-section>

      {fetcher.data?.ok && (
        <s-section heading="Last run">
          <s-paragraph>
            Stone price used: ₹{fetcher.data.stonePrice} · Variants updated:{" "}
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
          Products listed below don't have it set up yet.
        </s-paragraph>
        <s-button {...(isScanning ? { loading: true } : {})} onClick={scanSetup}>
          Scan Products
        </s-button>

        {scanFetcher.data?.intent === "scanSetup" && scanFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <p style={{ fontSize: "13px", color: "#6d7175", margin: "0 0 10px" }}>
              Scanned {scanFetcher.data.scanned} product{scanFetcher.data.scanned === 1 ? "" : "s"} ·{" "}
              {scanFetcher.data.missing.length} missing setup
              {scanFetcher.data.truncated ? " · stopped early (catalog larger than the scan's safety cap — rerun to continue)" : ""}
            </p>
            {scanFetcher.data.missing.length === 0 ? (
              <s-paragraph>Every product in the store has this set up. Nothing to do.</s-paragraph>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Title</th>
                      <th style={th}>Status</th>
                      <th style={th}>Handle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanFetcher.data.missing.map((p) => (
                      <tr key={p.id}>
                        <td style={td}>
                          <a
                            href={`https://admin.shopify.com/store/${shopDomain}/products/${p.numericId}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#2c6ecb" }}
                          >
                            {p.title}
                          </a>
                        </td>
                        <td style={td}>{p.status}</td>
                        <td style={td}>{p.handle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
