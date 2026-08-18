/**
 * Product <-> video matcher for the custom.product_video_url metafield
 * (confirmed live in theme code — see snippets/card-product.liquid,
 * product-media-gallery.liquid, shubh-gems-customizer.liquid,
 * sections/shubh-featured-collection.liquid, all of which read
 * product.metafields.custom.product_video_url.value).
 *
 * Lists every product with its CURRENT metafield value, whether it
 * already has a video in its own Media gallery, alongside a SUGGESTED
 * video the app found by scanning the store's Files library (Settings ->
 * Files) and matching each file's name against the product's SKU(s)
 * and/or title. Nothing is written until the merchant checks a row and
 * clicks Apply.
 *
 * Apply always sets the metafield. It can OPTIONALLY also upload the
 * matched video into the product's own Media gallery (productCreateMedia)
 * — a second, independent action: Shopify re-fetches and re-transcodes
 * its own copy of the file for the gallery, same as a manual upload would.
 * This never renames, deletes, or moves the original video file itself.
 *
 * Files-library uploads can come back as one of two GraphQL types, and
 * they must be handled differently to get the real name:
 *   - GenericFile: url keeps the original filename as-is
 *     (cdn.shopify.com/.../my-video-name.mp4) — filename is parsed off it.
 *   - Video: Shopify always transcodes these, so the CDN url is a hash
 *     with zero relation to what was uploaded
 *     (cdn.shopify.com/videos/c/o/v/ece62978....mp4) — the real name only
 *     exists in the separate `filename` field, which is what's used here.
 *     (This is true even for videos uploaded through Settings -> Files,
 *     not just Product Media — Shopify recognizes video content and
 *     transcodes it either way.)
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
            media(first: 20) { nodes { mediaContentType } }
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
        // How many videos are already attached in the product's own Media
        // gallery (Admin's "Media" section / the native storefront
        // gallery) — separate from the custom.product_video_url metafield,
        // which just points a URL for custom snippets to read.
        galleryVideoCount: (p.media?.nodes || []).filter((m) => m.mediaContentType === "VIDEO").length,
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
            ... on Video {
              filename
              sources { url format }
              originalSource { url }
            }
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
      if (f.sources || f.originalSource) {
        // Video-type file. Shopify transcodes these to a hash-based CDN
        // URL (e.g. .../ece62978ea5f419287b7293522c928c1.mp4) that has
        // nothing to do with the original filename — so the real name
        // has to come from the `filename` field, never parsed off the URL.
        if (!f.filename) continue;
        const mp4Source = (f.sources || []).find((s) => s.format === "mp4");
        const url = mp4Source?.url || f.sources?.[0]?.url || f.originalSource?.url;
        if (!url) continue; // still processing, no playable source yet
        files.push({ url, filename: f.filename });
        continue;
      }
      if (!f.url) continue; // not a GenericFile or Video (e.g. an image) — skip
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
      galleryVideoCount: p.galleryVideoCount,
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

// productCreateMedia's originalSource rejects URLs already on Shopify's
// own CDN ("Invalid video url") — it only accepts external hosts or a
// URL from Shopify's own staged-upload flow. Since the matched video
// file already lives on cdn.shopify.com (Files library), it has to be
// downloaded and re-uploaded through stagedUploadsCreate first — the
// same two-step flow the Admin UI itself uses for a manual upload —
// before productCreateMedia will accept it as a fresh source.
async function stagedUploadFromUrl(admin, sourceUrl, filename) {
  const fileRes = await fetch(sourceUrl);
  if (!fileRes.ok) {
    throw new Error(`Couldn't download source video (HTTP ${fileRes.status})`);
  }
  const mimeType = fileRes.headers.get("content-type") || "video/mp4";
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const stagedRes = await admin.graphql(
    `#graphql
    mutation StagedUploadForVideo($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [{ resource: "VIDEO", filename: filename || "video.mp4", mimeType, httpMethod: "POST" }],
      },
    }
  );
  const stagedJson = await stagedRes.json();
  const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const stagedErrors = stagedJson?.data?.stagedUploadsCreate?.userErrors || [];
  if (!target || stagedErrors.length || stagedJson.errors) {
    throw new Error("stagedUploadsCreate failed: " + JSON.stringify(stagedJson.errors || stagedErrors).slice(0, 200));
  }

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buffer], { type: mimeType }), filename || "video.mp4");

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged upload POST failed (HTTP ${uploadRes.status})`);
  }

  return target.resourceUrl;
}

async function uploadToProductGallery(admin, productId, url, filename) {
  let resourceUrl;
  try {
    resourceUrl = await stagedUploadFromUrl(admin, url, filename);
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 200) };
  }

  const res = await admin.graphql(
    `#graphql
    mutation UploadVideoToGallery($media: [CreateMediaInput!]!, $productId: ID!) {
      productCreateMedia(media: $media, productId: $productId) {
        media { alt mediaContentType }
        mediaUserErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        media: [{ originalSource: resourceUrl, mediaContentType: "VIDEO", alt: filename || "" }],
      },
    }
  );
  const json = await res.json();
  const errs = json?.data?.productCreateMedia?.mediaUserErrors || [];
  if (json.errors || errs.length) {
    return { ok: false, error: JSON.stringify(json.errors || errs).slice(0, 200) };
  }
  return { ok: true };
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const updatesRaw = formData.get("updates");
  const alsoUploadToGallery = formData.get("alsoUploadToGallery") === "1";
  const forceGalleryUpload = formData.get("forceGalleryUpload") === "1";

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

  if (!alsoUploadToGallery) {
    return { ok: true, applied: updates.length };
  }

  // Gallery upload: Shopify re-fetches the video from the given URL and
  // transcodes its own copy for the product's Media gallery — a separate
  // action from the metafield write above, done one product at a time
  // since productCreateMedia only takes a single productId per call. By
  // default, skips products that already have a video in the gallery
  // (galleryVideoCount > 0, sent from the client) to avoid piling up
  // duplicates — forceGalleryUpload overrides that.
  let uploaded = 0;
  const galleryErrors = [];
  for (const u of updates) {
    if (!forceGalleryUpload && u.galleryVideoCount > 0) continue;
    const result = await uploadToProductGallery(admin, u.productId, u.url, u.filename);
    if (result.ok) uploaded++;
    else galleryErrors.push(`${u.filename || u.productId}: ${result.error}`);
  }

  return {
    ok: true,
    applied: updates.length,
    galleryUploaded: uploaded,
    galleryErrors: galleryErrors.length ? galleryErrors.slice(0, 5) : null,
  };
};

const th = { textAlign: "left", padding: "8px 10px", fontSize: "12px", color: "#6d7175", borderBottom: "1px solid #e1e3e5" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f1f2f3", verticalAlign: "top" };

export default function VideoUrlsPage() {
  const { rows, totalProducts, totalVideoFiles, matchedCount } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const [checked, setChecked] = useState(() => new Set());
  const [alsoUploadToGallery, setAlsoUploadToGallery] = useState(false);
  const [forceGalleryUpload, setForceGalleryUpload] = useState(false);
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
      .map((r) => ({
        productId: r.id,
        url: r.suggestedUrl,
        filename: r.suggestedFilename,
        galleryVideoCount: r.galleryVideoCount,
      }));
    fetcher.submit(
      {
        updates: JSON.stringify(updates),
        alsoUploadToGallery: alsoUploadToGallery ? "1" : "0",
        forceGalleryUpload: forceGalleryUpload ? "1" : "0",
      },
      { method: "POST" }
    );
  };

  return (
    <s-page heading="Video URL matcher">
      <s-section heading={`Products (${totalProducts}) vs. video files found (${totalVideoFiles}) — ${matchedCount} matched`}>
        <s-paragraph>
          Scans your Files library (Settings → Files) for video files and matches each one to a product by SKU or
          title. Nothing is written until you check rows and click Apply — by default this only sets the{" "}
          <s-text>custom.product_video_url</s-text> metafield, it never touches the video files themselves.
          {" "}Products with no match are still listed (greyed out, can't be checked) so you can see what's left to
          upload. Check "Also upload to Media gallery" below if you also want the matched video attached to each
          product's own gallery, not just the metafield.
        </s-paragraph>

        <div style={{ display: "flex", gap: "10px", margin: "12px 0", alignItems: "center", flexWrap: "wrap" }}>
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

        <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "10px 14px", marginBottom: "12px" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={alsoUploadToGallery}
              onChange={(e) => setAlsoUploadToGallery(e.target.checked)}
              style={{ marginTop: "2px" }}
            />
            <span>
              Also upload the matched video into each product's <strong>Media gallery</strong> (not just the
              metafield) — Shopify re-encodes its own copy from the matched file, so it shows up in the product's
              normal gallery/images-and-videos section, same as if uploaded by hand. Skips products that already
              have a video in their gallery, unless you check the box below.
            </span>
          </label>
          {alsoUploadToGallery && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer", marginTop: "8px", marginLeft: "24px" }}>
              <input
                type="checkbox"
                checked={forceGalleryUpload}
                onChange={(e) => setForceGalleryUpload(e.target.checked)}
              />
              <span>Upload even for products that already have a video in the gallery (adds a duplicate, doesn't replace it)</span>
            </label>
          )}
        </div>

        {fetcher.data?.ok === false && <p style={{ color: "#d82c0d", fontSize: "13px" }}>{fetcher.data.error}</p>}
        {fetcher.data?.ok && (
          <p style={{ color: "#008060", fontSize: "13px" }}>
            Applied metafield to {fetcher.data.applied} product(s).
            {fetcher.data.galleryUploaded !== undefined &&
              ` Uploaded to gallery for ${fetcher.data.galleryUploaded} product(s).`}
            {" "}Reload the page to see updated values.
            {fetcher.data.galleryErrors && (
              <span style={{ display: "block", color: "#d82c0d", marginTop: "4px" }}>
                Gallery upload failed for: {fetcher.data.galleryErrors.join("; ")}
              </span>
            )}
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
                <th style={th}>In product gallery</th>
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
                  <td style={{ ...td, fontSize: "12px" }}>
                    {r.galleryVideoCount > 0 ? (
                      <span style={{ color: "#008060" }}>
                        ✓ {r.galleryVideoCount} video{r.galleryVideoCount > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span style={{ color: "#8c9196" }}>— none</span>
                    )}
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
