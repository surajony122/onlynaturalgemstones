/**
 * Product <-> video matcher for the custom.product_video_url metafield
 * (confirmed live in theme code — see snippets/card-product.liquid,
 * product-media-gallery.liquid, shubh-gems-customizer.liquid,
 * sections/shubh-featured-collection.liquid, all of which read
 * product.metafields.custom.product_video_url.value).
 *
 * Lists every product with its CURRENT metafield value alongside a
 * SUGGESTED video the app found by scanning the store's Files library
 * (Settings -> Files — NOT Product Media, which auto-transcodes and
 * loses the filename; see the file-naming conversation this page came
 * out of) and matching each file's name against the product's SKU(s)
 * and/or title. Nothing is written until the merchant checks a row and
 * clicks Apply — this never renames, uploads, or moves the actual video
 * file, only points the metafield at whichever Files-library file
 * already has a matching name.
 *
 * Matching, in priority order:
 *   1. SKU match — any variant SKU (normalized: lowercase, strip
 *      non-alphanumeric) appears as a substring of the normalized
 *      filename. Strongest signal since SKUs are usually unique.
 *   2. Title match — fallback when no SKU match: significant words
 *      (4+ letters, ignoring generic filler like "the"/"and") from the
 *      product title are checked against the filename; matches if most
 *      of them appear.
 * Each suggested row is labeled with which one fired, so it's obvious
 * why the app thinks that's the right file — not a silent guess.
 */
import { useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAFIELD_NAMESPACE = "custom";
const METAFIELD_KEY = "product_video_url";
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];
const STOPWORDS = new Set(["the", "and", "for", "with", "from", "this", "that"]);

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleTokens(title) {
  return String(title || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

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

async function fetchAllProducts(admin) {
  const products = [];
  let after = null;
  // Capped at 500 (5 pages of 100) — enough for this store's catalog
  // size without risking a very long page load; rerun after a batch is
  // applied to pick up the rest if the store ever grows past this.
  for (let page = 0; page < 5; page++) {
    const res = await admin.graphql(
      `#graphql
      query AllProductsForVideoMatch($after: String) {
        products(first: 100, after: $after) {
          nodes {
            id
            title
            metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") { value }
            variants(first: 20) { nodes { sku } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { after } }
    );
    const json = await res.json();
    const conn = json?.data?.products;
    if (!conn) break;
    products.push(
      ...conn.nodes.map((p) => ({
        id: p.id,
        title: p.title,
        currentUrl: p.metafield?.value || "",
        skus: (p.variants?.nodes || []).map((v) => v.sku).filter(Boolean),
      }))
    );
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return products;
}

async function fetchAllVideoFiles(admin) {
  const files = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const res = await admin.graphql(
      `#graphql
      query AllFilesForVideoMatch($after: String) {
        files(first: 100, after: $after) {
          nodes {
            id
            ... on GenericFile { url }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { after } }
    );
    const json = await res.json();
    const conn = json?.data?.files;
    if (!conn) break;
    for (const f of conn.nodes) {
      if (!f.url) continue; // not a GenericFile (e.g. an image) — skip
      const filename = decodeURIComponent(f.url.split("/").pop().split("?")[0]);
      if (!VIDEO_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))) continue;
      files.push({ url: f.url, filename });
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return files;
}

function findMatch(product, files) {
  const normalizedSkus = product.skus.map(normalize).filter((s) => s.length >= 4);
  for (const file of files) {
    const normalizedFilename = normalize(file.filename);
    for (const sku of normalizedSkus) {
      if (normalizedFilename.includes(sku)) {
        return { url: file.url, filename: file.filename, matchedBy: "SKU" };
      }
    }
  }
  const tokens = titleTokens(product.title);
  if (tokens.length) {
    for (const file of files) {
      const normalizedFilename = normalize(file.filename);
      const hits = tokens.filter((t) => normalizedFilename.includes(t));
      if (hits.length >= Math.max(1, Math.ceil(tokens.length * 0.6))) {
        return { url: file.url, filename: file.filename, matchedBy: "title" };
      }
    }
  }
  return null;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const [products, files] = await Promise.all([fetchAllProducts(admin), fetchAllVideoFiles(admin)]);

  const rows = products.map((p) => {
    const match = findMatch(p, files);
    return {
      id: p.id,
      title: p.title,
      skus: p.skus.join(", "),
      currentUrl: p.currentUrl,
      suggestedUrl: match?.url || null,
      suggestedFilename: match?.filename || null,
      matchedBy: match?.matchedBy || null,
    };
  });

  return {
    rows,
    totalProducts: products.length,
    totalVideoFiles: files.length,
    matchedCount: rows.filter((r) => r.suggestedUrl).length,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const updatesRaw = formData.get("updates");

  let updates;
  try {
    updates = JSON.parse(updatesRaw);
  } catch {
    return { ok: false, error: "Bad request." };
  }
  if (!Array.isArray(updates) || !updates.length) {
    return { ok: false, error: "Check at least one row first." };
  }

  const metafieldType = await getMetafieldType(admin);

  const res = await admin.graphql(
    `#graphql
    mutation SetVideoUrls($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: updates.map((u) => ({
          ownerId: u.productId,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY,
          type: metafieldType,
          value: u.url,
        })),
      },
    }
  );
  const json = await res.json();
  const userErrors = json?.data?.metafieldsSet?.userErrors || [];
  if (json.errors || userErrors.length) {
    return { ok: false, error: "FAILED: " + JSON.stringify(json.errors || userErrors).slice(0, 300) };
  }
  return { ok: true, applied: updates.length };
};

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", verticalAlign: "top" };

export default function VideoUrlsPage() {
  const { rows, totalProducts, totalVideoFiles, matchedCount } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const [checked, setChecked] = useState(() => new Set());
  const matchedRows = useMemo(() => rows.filter((r) => r.suggestedUrl), [rows]);

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkAllMatched = () => setChecked(new Set(matchedRows.map((r) => r.id)));
  const clearAll = () => setChecked(new Set());

  const apply = () => {
    const updates = rows
      .filter((r) => checked.has(r.id) && r.suggestedUrl)
      .map((r) => ({ productId: r.id, url: r.suggestedUrl }));
    fetcher.submit({ updates: JSON.stringify(updates) }, { method: "POST" });
  };

  return (
    <s-page heading="Video URL matcher">
      <s-section heading={`Products (${totalProducts}) vs. video files found (${totalVideoFiles}) — ${matchedCount} matched`}>
        <s-paragraph>
          Scans your Files library (Settings → Files) for video files and matches each one to a product by SKU or
          title. Nothing is written until you check rows and click Apply — this only sets the{" "}
          <s-text>custom.product_video_url</s-text> metafield, it never touches the video files themselves.
          {" "}Products with no match are still listed (greyed out, can't be checked) so you can see what's left to
          upload.
        </s-paragraph>

        <div style={{ display: "flex", gap: "10px", margin: "12px 0" }}>
          <button type="button" onClick={checkAllMatched} disabled={!matchedRows.length}
            style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }}>
            Check all matched ({matchedRows.length})
          </button>
          <button type="button" onClick={clearAll}
            style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer" }}>
            Clear selection
          </button>
          <s-button {...(busy ? { loading: true } : {})} onClick={apply}>
            Apply to {checked.size} selected
          </s-button>
        </div>

        {fetcher.data?.ok === false && <p style={{ color: "#d82c0d", fontSize: "13px" }}>{fetcher.data.error}</p>}
        {fetcher.data?.ok && (
          <p style={{ color: "#008060", fontSize: "13px" }}>
            Applied to {fetcher.data.applied} product(s). Reload the page to see updated "Current" values.
          </p>
        )}

        <div style={{ overflowX: "auto", marginTop: "12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Product</th>
                <th style={th}>SKU(s)</th>
                <th style={th}>Current video URL (metafield)</th>
                <th style={th}>Suggested match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.suggestedUrl ? 1 : 0.5 }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      disabled={!r.suggestedUrl}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td style={td}>{r.title}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: "11px" }}>{r.skus || "—"}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: "11px", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }} title={r.currentUrl}>
                    {r.currentUrl || "(not set)"}
                  </td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: "11px", maxWidth: "260px" }}>
                    {r.suggestedUrl ? (
                      <>
                        <div style={{ color: "#008060" }}>{r.suggestedFilename}</div>
                        <div style={{ fontSize: "10px", color: "#6d7175" }}>matched by {r.matchedBy}</div>
                      </>
                    ) : (
                      "no match found"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
