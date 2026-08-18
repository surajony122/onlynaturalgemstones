/**
 * Bulk-sets the custom.product_video_url metafield (confirmed live in
 * theme code — snippets/card-product.liquid, product-media-gallery.liquid,
 * shubh-gems-customizer.liquid, sections/shubh-featured-collection.liquid
 * all read product.metafields.custom.product_video_url.value) from a
 * pasted SKU -> video URL list, matched by product SKU per explicit
 * user request.
 *
 * Deliberately does NOT try to guess/construct the video URL from a
 * filename itself (Shopify's exact file-path prefix is store-specific
 * and fragile to hardcode) — the user already has the working formula
 * (prefix + filename, from Settings -> Files uploads) and builds the
 * full URL in their own sheet; this page's job is just the bulk-apply-
 * to-Shopify part, which is what's actually tedious/error-prone across
 * many products by hand.
 *
 * Input format: one product per line, SKU and URL separated by a comma
 * or tab (so pasting straight from a spreadsheet — which uses tabs
 * between columns — works without any reformatting):
 *   YV801625023-5,https://cdn.shopify.com/s/files/1/.../Yellow-Sapphire-YV801625023-5.mp4
 *
 * The metafield's actual type (single_line_text_field vs url, etc.) is
 * looked up once via metafieldDefinitions before writing anything, so
 * this matches whatever type the merchant's existing definition already
 * uses rather than guessing and risking a type-mismatch error on every
 * row.
 */
import { useState } from "react";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAFIELD_NAMESPACE = "custom";
const METAFIELD_KEY = "product_video_url";

async function getMetafieldType(admin) {
  const res = await admin.graphql(
    `#graphql
    query VideoUrlMetafieldDefinition {
      metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
        nodes { type { name } }
      }
    }`
  );
  const json = await res.json();
  return json?.data?.metafieldDefinitions?.nodes?.[0]?.type?.name || "single_line_text_field";
}

async function findProductIdBySku(admin, sku) {
  const safeSku = sku.replace(/"/g, "");
  const res = await admin.graphql(
    `#graphql
    query ProductBySku($q: String!) {
      productVariants(first: 1, query: $q) {
        nodes { id product { id title } }
      }
    }`,
    { variables: { q: `sku:${safeSku}` } }
  );
  const json = await res.json();
  const node = json?.data?.productVariants?.nodes?.[0];
  return node ? { productId: node.product.id, title: node.product.title } : null;
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const rawInput = formData.get("input") || "";

  const lines = rawInput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { ok: false, error: "Paste at least one SKU,URL line first." };
  }

  const metafieldType = await getMetafieldType(admin);

  const results = [];
  for (const line of lines) {
    const parts = line.includes("\t") ? line.split("\t") : line.split(",");
    const sku = (parts[0] || "").trim();
    const url = (parts.slice(1).join(",") || "").trim();

    if (!sku || !url) {
      results.push({ sku: sku || "(blank)", ok: false, detail: "Missing SKU or URL on this line — skipped." });
      continue;
    }

    try {
      const match = await findProductIdBySku(admin, sku);
      if (!match) {
        results.push({ sku, ok: false, detail: "No product found with this SKU." });
        continue;
      }

      const res = await admin.graphql(
        `#graphql
        mutation SetVideoUrl($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId: match.productId,
                namespace: METAFIELD_NAMESPACE,
                key: METAFIELD_KEY,
                type: metafieldType,
                value: url,
              },
            ],
          },
        }
      );
      const json = await res.json();
      const userErrors = json?.data?.metafieldsSet?.userErrors || [];
      if (json.errors || userErrors.length) {
        results.push({
          sku,
          title: match.title,
          ok: false,
          detail: "FAILED: " + JSON.stringify(json.errors || userErrors).slice(0, 200),
        });
      } else {
        results.push({ sku, title: match.title, ok: true, detail: "OK: video URL set" });
      }
    } catch (err) {
      results.push({ sku, ok: false, detail: "threw: " + String(err?.message || err) });
    }
  }

  return {
    ok: true,
    metafieldType,
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results,
  };
};

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", verticalAlign: "top" };

export default function VideoUrlsPage() {
  const fetcher = useFetcher();
  const [input, setInput] = useState("");
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  const submit = () => fetcher.submit({ input }, { method: "POST" });

  return (
    <s-page heading="Bulk product video URLs">
      <s-section heading="Set custom.product_video_url from a SKU list">
        <s-paragraph>
          One product per line: <s-text>SKU, video URL</s-text> — paste straight from a spreadsheet (tab-separated
          also works). Matches each SKU to its product and sets the same{" "}
          <s-text>custom.product_video_url</s-text> metafield your theme already reads on the product card, media
          gallery, and customizer. Doesn't touch anything else on the product.
        </s-paragraph>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"YV801625023-5,https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Yellow-Sapphire-YV801625023-5.mp4\nYV801625024-2,https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Yellow-Sapphire-YV801625024-2.mp4"}
          style={{
            width: "100%",
            minHeight: "200px",
            fontFamily: "monospace",
            fontSize: "12px",
            padding: "10px",
            border: "1px solid #c9cccf",
            borderRadius: "6px",
            boxSizing: "border-box",
            marginBottom: "12px",
          }}
        />

        <s-button {...(busy ? { loading: true } : {})} onClick={submit}>
          Set video URLs
        </s-button>

        {data?.ok === false && (
          <p style={{ color: "#d82c0d", fontSize: "13px", marginTop: "10px" }}>{data.error}</p>
        )}

        {data?.ok && (
          <div style={{ marginTop: "16px" }}>
            <p style={{ fontSize: "13px", color: "#6d7175", marginBottom: "10px" }}>
              {data.succeeded} of {data.total} succeeded · metafield type used: <s-text>{data.metafieldType}</s-text>
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>SKU</th>
                    <th style={th}>Product</th>
                    <th style={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{r.sku}</td>
                      <td style={td}>{r.title || "—"}</td>
                      <td style={{ ...td, color: r.ok ? "#008060" : "#d82c0d" }}>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
