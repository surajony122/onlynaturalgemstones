import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { repriceDesignVariants, PRODUCT_ID_NUMERIC } from "../utils/repriceDesignVariants.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // PRODUCT_ID_NUMERIC lives in a .server.js file — React Router strips
  // server-only modules from the client bundle, so a component can't
  // import it directly for use in JSX (that broke the build). Returning
  // it from the loader and reading it via useLoaderData is the
  // server -> client handoff React Router actually supports.
  return { productId: PRODUCT_ID_NUMERIC };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  try {
    const result = await repriceDesignVariants(admin);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
};

export default function Index() {
  const { productId } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(`Repriced ${fetcher.data.variantCount} variants`);
    } else if (fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const reprice = () => fetcher.submit({}, { method: "POST" });

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
