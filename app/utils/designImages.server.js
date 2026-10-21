/**
 * Design-image health check. Reads the PUBLISHED theme's design list
 * (snippets/shubh-gems-global-designs.liquid -- the fallback list the product
 * page's design chooser uses), then checks that every picture it points at
 * still loads. Exists because pictures in Shopify Files have gone missing
 * without anyone noticing until a customer saw a broken card.
 *
 * Two kinds of entries:
 *   - "files"       a cdn.shopify.com/.../files/<name> address (Shopify Files)
 *   - "theme-asset" {{ 'name.jpg' | asset_url }} (stored inside the theme)
 *
 * A saved copy of every picture lives in this repo under design-images/
 * (see design-images/README.md) -- the report shows whether each one has a
 * backup, so a missing picture can be restored by uploading that file to
 * Shopify Files under the same name.
 *
 * Read-only: never edits the theme or Shopify Files.
 */
import fs from "fs";
import path from "path";
import { findLiveThemeId } from "./shopify-admin.server";

const SNIPPET = "snippets/shubh-gems-global-designs.liquid";
const CHECK_TIMEOUT_MS = 8000;
const PARALLEL = 8;

async function readThemeFile(admin, themeGid, filename) {
  const res = await admin.graphql(
    `#graphql
    query ThemeFileForDesignImages($id: ID!, $filenames: [String!]!) {
      theme(id: $id) {
        files(filenames: $filenames, first: 1) {
          nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }`,
    { variables: { id: themeGid, filenames: [filename] } },
  );
  const json = await res.json();
  if (json.errors?.length) throw new Error("Theme file lookup failed: " + JSON.stringify(json.errors).slice(0, 200));
  const node = json.data?.theme?.files?.nodes?.[0];
  return { exists: !!node, content: node?.body?.content ?? null };
}

/** Pulls every design image out of the snippet: {key, kind, name, design}. */
export function parseDesignImages(text) {
  const entries = [];
  let design = null;
  for (const line of String(text || "").split("\n")) {
    const d = line.match(/"design":\s*"([^"]+)"/);
    if (d) design = d[1];
    if (!/"image":/.test(line)) continue;
    const asset = line.match(/\{\{\s*'([^']+)'\s*\|\s*asset_url\s*\}\}/);
    if (asset) {
      entries.push({ key: "asset:" + asset[1], kind: "theme-asset", name: asset[1], design });
      continue;
    }
    const lit = line.match(/"image":\s*"(https?:[^"]+)"/);
    if (lit) {
      const name = decodeURIComponent(lit[1].split("?")[0].split("/").pop() || lit[1]);
      entries.push({ key: lit[1], kind: "files", name, url: lit[1], design });
    }
  }
  return entries;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "ONG-Controls-health-check" }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    const type = res.headers.get("content-type") || "";
    const ok = res.status === 200 && type.startsWith("image/");
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { ok, detail: ok ? "OK" : `HTTP ${res.status}${type && !type.startsWith("image/") ? " (not an image)" : ""}` };
  } catch (err) {
    return { ok: false, detail: "No answer: " + String((err && err.message) || err).slice(0, 80) };
  }
}

function backupIndex() {
  try {
    const dir = path.resolve(process.cwd(), "design-images");
    if (!fs.existsSync(dir)) return { available: false, has: () => false, count: 0 };
    const names = new Set(fs.readdirSync(dir));
    return { available: true, has: (n) => names.has(n), count: [...names].filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).length };
  } catch {
    return { available: false, has: () => false, count: 0 };
  }
}

export async function getDesignImageReport(admin) {
  const live = await findLiveThemeId(admin);
  const snippet = await readThemeFile(admin, live.id, SNIPPET);
  if (!snippet.exists || !snippet.content) {
    return { ok: false, error: `The published theme "${live.name}" has no ${SNIPPET}.`, themeName: live.name, rows: [] };
  }
  const entries = parseDesignImages(snippet.content);
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e.key) || { ...e, designs: new Set(), uses: 0 };
    if (e.design) g.designs.add(e.design);
    g.uses += 1;
    groups.set(e.key, g);
  }
  const list = [...groups.values()];
  const backup = backupIndex();

  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const g = list[i];
      results[i] = g.kind === "files" ? await checkUrl(g.url) : await (async () => {
        const f = await readThemeFile(admin, live.id, "assets/" + g.name);
        return { ok: f.exists, detail: f.exists ? "OK (stored in the theme)" : "Missing from the theme's assets" };
      })();
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const rows = list
    .map((g, i) => ({
      name: g.name,
      kind: g.kind,
      url: g.url || null,
      designs: [...g.designs].sort(),
      uses: g.uses,
      ok: results[i].ok,
      detail: results[i].detail,
      backedUp: backup.has(g.name),
    }))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));

  const broken = rows.filter((r) => !r.ok);
  return {
    ok: true,
    themeName: live.name,
    checkedAt: new Date().toISOString(),
    total: rows.length,
    working: rows.length - broken.length,
    broken: broken.length,
    backupAvailable: backup.available,
    backupCount: backup.count,
    rows,
  };
}

/** Plain-language summary for the alert email (same shape the health-alert email expects). */
export function designImageAlertCheck(report) {
  const broken = report.rows.filter((r) => !r.ok);
  const names = broken.slice(0, 12).map((r) => r.name).join(", ") + (broken.length > 12 ? ` and ${broken.length - 12} more` : "");
  const restorable = broken.filter((r) => r.backedUp).length;
  return {
    name: "Design images",
    status: "FAIL",
    plain:
      `${broken.length} design picture${broken.length === 1 ? " is" : "s are"} not loading on your product pages (${names}). ` +
      (restorable
        ? `A saved copy of ${restorable === broken.length ? "each one" : restorable + " of them"} is in the app's design-images folder: upload it to Shopify admin > Content > Files under the same name.`
        : "No saved copy was found for these; upload the pictures to Shopify admin > Content > Files under the same names."),
  };
}
