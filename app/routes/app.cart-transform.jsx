import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let activeTransform = null;
  let availableFunctions = [];
  let errorMsg = null;

  try {
    // 1. Get active cartTransforms
    const transformRes = await admin.graphql(
      `#graphql
      query GetCartTransforms {
        cartTransforms(first: 5) {
          nodes {
            id
            functionId
            blockDeployments
          }
        }
      }`
    );
    const transformData = await transformRes.json();
    const nodes = transformData?.data?.cartTransforms?.nodes || [];
    if (nodes.length > 0) {
      activeTransform = nodes[0];
    }

    // 2. Get deployed functions for cart_transform
    const functionsRes = await admin.graphql(
      `#graphql
      query GetShopifyFunctions {
        shopifyFunctions(first: 10) {
          nodes {
            id
            title
            apiType
            app {
              title
            }
          }
        }
      }`
    );
    const functionsData = await functionsRes.json();
    availableFunctions = functionsData?.data?.shopifyFunctions?.nodes || [];
  } catch (err) {
    console.error("Error in Cart Transform loader:", err);
    errorMsg = err.message;
  }

  return {
    activeTransform,
    availableFunctions,
    errorMsg,
    shop: admin.rest?.session?.shop || "",
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "activate") {
    let functionId = formData.get("functionId");

    try {
      // If functionId is not a full GID or UUID, find it from deployed functions
      if (!functionId || functionId === "cart-transform" || functionId === "cart-transform-bundle") {
        const functionsRes = await admin.graphql(
          `#graphql
          query GetCartTransformFunction {
            shopifyFunctions(first: 10) {
              nodes {
                id
                title
                apiType
              }
            }
          }`
        );
        const functionsData = await functionsRes.json();
        const found = (functionsData?.data?.shopifyFunctions?.nodes || []).find(
          (f) => f.apiType === "cart_transform" || f.title?.toLowerCase().includes("cart-transform")
        );
        if (found) {
          functionId = found.id;
        } else {
          functionId = "96c6d7ec-66ef-b768-41f5-696ea678bcf8e849fc5c";
        }
      }

      const response = await admin.graphql(
        `#graphql
        mutation CreateCartTransform($functionId: String!) {
          cartTransformCreate(functionId: $functionId) {
            cartTransform {
              id
              functionId
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            functionId: functionId,
          },
        }
      );
      const data = await response.json();
      const userErrors = data?.data?.cartTransformCreate?.userErrors || [];
      if (userErrors.length > 0) {
        return { success: false, error: userErrors.map((e) => e.message).join(", ") };
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (intent === "deactivate") {
    const transformId = formData.get("transformId");
    try {
      const response = await admin.graphql(
        `#graphql
        mutation DeleteCartTransform($id: ID!) {
          cartTransformDelete(id: $id) {
            deletedId
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: { id: transformId },
        }
      );
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: true };
};

export default function CartTransformPage() {
  const { activeTransform, availableFunctions, errorMsg } = useLoaderData();
  const fetcher = useFetcher();
  const [testGemstone, setTestGemstone] = useState("Blue Sapphire - 4.87 Carat");
  const [testCustomization, setTestCustomization] = useState("Ring Customisation (RD11 - Panchdhatu)");
  const [testPrice, setTestPrice] = useState("₹ 297,500 + ₹ 900 = ₹ 298,400");

  const isSubmitting = fetcher.state === "submitting";
  const isFunctionActive = !!activeTransform;
  const actionError = fetcher.data?.error || errorMsg;
  const actionSuccess = fetcher.data?.success;

  return (
    <s-page heading="Checkout Cart Transform Bundling">
      <s-page-actions>
        <s-button
          variant={isFunctionActive ? "destructive" : "primary"}
          onClick={() => {
            if (isFunctionActive) {
              fetcher.submit(
                { intent: "deactivate", transformId: activeTransform.id },
                { method: "POST" }
              );
            } else {
              const fId = availableFunctions[0]?.id || "96c6d7ec-66ef-b768-41f5-696ea678bcf8e849fc5c";
              fetcher.submit(
                { intent: "activate", functionId: fId },
                { method: "POST" }
              );
            }
          }}
          disabled={isSubmitting}
        >
          {isFunctionActive ? "Deactivate Function" : "Activate Cart Transform"}
        </s-button>
      </s-page-actions>

      <s-layout>
        {actionError && (
          <s-layout-section>
            <s-banner tone="critical">
              <s-text>Error: {actionError}</s-text>
            </s-banner>
          </s-layout-section>
        )}
        {actionSuccess && (
          <s-layout-section>
            <s-banner tone="success">
              <s-text>Cart Transform status updated successfully!</s-text>
            </s-banner>
          </s-layout-section>
        )}
        {/* Status Card */}
        <s-layout-section>
          <s-card>
            <s-block-stack gap="400">
              <s-inline-stack align="space-between" block-align="center">
                <s-text variant="headingMd" as="h2">
                  Function Status
                </s-text>
                <s-badge tone={isFunctionActive ? "success" : "attention"}>
                  {isFunctionActive ? "Active on Checkout" : "Ready / Standby"}
                </s-badge>
              </s-inline-stack>

              <s-text tone="subdued">
                The Cart Transform Function executes natively in WebAssembly (&lt;5ms) during
                checkout. It bundles child customization charges (₹1.00 × 900) into the parent gemstone,
                ensuring customers see <strong>Quantity: 1</strong> and the combined price.
              </s-text>

              {activeTransform && (
                <s-banner tone="info">
                  <s-text>
                    Registered Transform ID: <code>{activeTransform.id}</code>
                  </s-text>
                </s-banner>
              )}
            </s-block-stack>
          </s-card>
        </s-layout-section>

        {/* How it works Card */}
        <s-layout-section>
          <s-card>
            <s-block-stack gap="400">
              <s-text variant="headingMd" as="h2">
                Bundling Rules
              </s-text>
              <s-text>
                1. <strong>Matching Logic:</strong> Detects line items with product handle <code>gemstone-customisation</code> or <code>jewelry-customization-charge</code> linked via <code>Linked Gemstone</code> or <code>_bundle_id</code>.
              </s-text>
              <s-text>
                2. <strong>Merge Operation:</strong> Merges both lines into 1 parent line with <strong>Qty: 1</strong>.
              </s-text>
              <s-text>
                3. <strong>Title Formatting:</strong> Updates the checkout line title to <code>[Gemstone Title] (with [Customization Type])</code>.
              </s-text>
            </s-block-stack>
          </s-card>
        </s-layout-section>

        {/* Live Transformation Simulator */}
        <s-layout-section>
          <s-card>
            <s-block-stack gap="400">
              <s-text variant="headingMd" as="h2">
                Checkout Preview Simulator
              </s-text>
              <s-text tone="subdued">
                Visualizing how cart lines convert to a single checkout line item:
              </s-text>

              <s-box padding="400" background="bg-surface-secondary" border-radius="200">
                <s-block-stack gap="200">
                  <s-text variant="bodySm" tone="subdued">BEFORE TRANSFORM (Cart):</s-text>
                  <s-text>• {testGemstone} — Qty: 1 (₹ 297,500.00)</s-text>
                  <s-text>• Gemstone Customisation — Qty: 900 (₹ 900.00)</s-text>
                  
                  <s-divider />
                  
                  <s-text variant="bodySm" tone="subdued">AFTER TRANSFORM (Shopify Checkout):</s-text>
                  <s-text variant="headingSm">
                    🎉 {testGemstone} (with Ring Customisation) — <strong>Qty: 1</strong> ({testPrice})
                  </s-text>
                </s-block-stack>
              </s-box>
            </s-block-stack>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
