/**
 * Store activity log: records deletions made in the Shopify store so the
 * merchant can see what disappeared, and when.
 *
 *  - Products, collections, customers and themes: Shopify sends a "deleted"
 *    webhook (see app/routes/webhooks.*.delete.jsx). The exact time is known,
 *    and Shopify's event history sometimes names who did it (best effort).
 *  - Files (pictures): Shopify has NO delete webhook for them, so this module
 *    keeps a saved list of every file and compares it with the current list on
 *    a schedule (runStoreSnapshot). A vanished file is logged with the window
 *    it disappeared in ("after <last check>, before <this check>"). Shopify
 *    does not say who deleted a file, so that column stays empty for them.
 *  - The published theme's files get the same comparison.
 *
 * First run of a snapshot only saves the baseline; nothing is logged.
 * Read-only toward Shopify: this never deletes or edits anything there.
 */
import prisma from "../db.server";
import { findLiveThemeId } from "./shopify-admin.server";

const PAGE = 250;
const MAX_PAGES = 40;

export async function logDeletion({ shop, kind, resourceId, title, detail, source, actor, happenedAt, windowStart, note }) {
  return prisma.storeDeletionEvent.create({
    data: {
      shop: shop || "unknown",
      kind,
      resourceId: resourceId ? String(resourceId) : null,
      title: title || null,
      detail: detail || null,
      source,
      actor: actor || null,
      happenedAt: happenedAt || null,
      windowStart: windowStart || null,
      note: note || null,
    },
  });
}

/** Best effort: asks Shopify's event history who deleted a product/collection.
 * Never throws -- returns null if it can't tell. */
export async function lookupDeleteAuthor(admin, subjectType, numericId) {
  if (!admin) return null;
  const search = `action:destroy AND subject_type:${subjectType}`;
  const tryQuery = async (fields) => {
    const res = await admin.graphql(
      `#graphql
      query RecentDeletes($q: String!) {
        events(first: 15, sortKey: CREATED_AT, reverse: true, query: $q) {
          nodes { __typename ... on Event { message createdAt } ${fields} }
        }
      }`,
      { variables: { q: search } },
    );
    const json = await res.json();
    if (json.errors?.length) throw new Error(JSON.stringify(json.errors).slice(0, 200));
    return json.data?.events?.nodes || [];
  };
  let nodes;
  try {
    nodes = await tryQuery("... on BasicEvent { author subjectId }");
  } catch {
    try { nodes = await tryQuery(""); } catch { return null; }
  }
  const idMatch = nodes.find((n) => n.subjectId && String(n.subjectId).endsWith("/" + numericId));
  const recent = nodes.find((n) => Date.now() - new Date(n.createdAt).getTime() < 3 * 60 * 1000);
  const hit = idMatch || recent;
  if (!hit) return null;
  return { author: hit.author || null, message: hit.message || null, createdAt: hit.createdAt || null };
}

const nameFromUrl = (u) => {
  try { return decodeURIComponent(String(u).split("?")[0].split("/").pop() || ""); } catch { return String(u || ""); }
};

async function fetchAllFiles(admin) {
  const items = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await admin.graphql(
      `#graphql
      query AllFiles($first: Int!, $after: String) {
        files(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            alt
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
      }`,
      { variables: { first: PAGE, after } },
    );
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; ").slice(0, 300));
    const conn = json.data?.files;
    for (const n of conn?.nodes || []) {
      const url = n.image?.url || n.url || null;
      items.push({ itemId: n.id, name: (url && nameFromUrl(url)) || n.alt || n.id, url });
    }
    if (!conn?.pageInfo?.hasNextPage) return items;
    after = conn.pageInfo.endCursor;
  }
  throw new Error("Too many files to list in one run");
}

async function fetchThemeFiles(admin) {
  const live = await findLiveThemeId(admin);
  const numeric = String(live.id).split("/").pop();
  const items = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await admin.graphql(
      `#graphql
      query LiveThemeFileList($id: ID!, $first: Int!, $after: String) {
        theme(id: $id) {
          files(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { filename }
          }
        }
      }`,
      { variables: { id: live.id, first: PAGE, after } },
    );
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; ").slice(0, 300));
    const conn = json.data?.theme?.files;
    for (const n of conn?.nodes || []) items.push({ itemId: `${numeric}:${n.filename}`, name: n.filename, url: null });
    if (!conn?.pageInfo?.hasNextPage) return { items, themeName: live.name };
    after = conn.pageInfo.endCursor;
  }
  throw new Error("Too many theme files to list in one run");
}

/** Compares the saved list for one kind with the current list and logs what vanished. */
async function diffAndLog({ shop, kind, current, labelFor, noteFor }) {
  const previous = await prisma.fileSnapshotItem.findMany({ where: { shop, kind } });
  const lastRun = await prisma.storeSnapshotRun.findFirst({ where: { shop, kind, error: null }, orderBy: { ranAt: "desc" } });
  const baseline = !lastRun;
  const currentIds = new Set(current.map((c) => c.itemId));
  const gone = baseline ? [] : previous.filter((p) => !currentIds.has(p.itemId));
  const windowStart = lastRun?.ranAt || null;

  for (const g of gone) {
    await logDeletion({
      shop,
      kind,
      resourceId: g.itemId,
      title: labelFor(g),
      detail: g.url || g.itemId,
      source: "snapshot",
      windowStart,
      note: noteFor ? noteFor(g, gone.length) : null,
    });
  }
  if (gone.length) {
    await prisma.fileSnapshotItem.deleteMany({ where: { shop, kind, itemId: { in: gone.map((g) => g.itemId) } } });
  }
  // upsert everything that exists now
  const known = new Set(previous.map((p) => p.itemId));
  const fresh = current.filter((c) => !known.has(c.itemId));
  if (fresh.length) {
    await prisma.fileSnapshotItem.createMany({
      data: fresh.map((c) => ({ shop, kind, itemId: c.itemId, name: c.name, url: c.url })),
      skipDuplicates: true,
    });
  }
  const seen = current.filter((c) => known.has(c.itemId));
  if (seen.length) {
    await prisma.fileSnapshotItem.updateMany({ where: { shop, kind, itemId: { in: seen.map((c) => c.itemId) } }, data: { lastSeenAt: new Date() } });
  }
  return { baseline, deleted: gone.length, total: current.length };
}

async function snapshotKind(admin, shop, kind) {
  try {
    const current = kind === "file" ? await fetchAllFiles(admin) : (await fetchThemeFiles(admin)).items;
    const r = await diffAndLog({
      shop,
      kind,
      current,
      labelFor: (g) => g.name,
      noteFor: (g, count) => (count >= 10 ? `${count} items vanished in the same check` : null),
    });
    await prisma.storeSnapshotRun.create({ data: { shop, kind, itemCount: r.total, deletedCount: r.deleted, baseline: r.baseline } });
    return { ok: true, ...r };
  } catch (err) {
    const message = String((err && err.message) || err);
    await prisma.storeSnapshotRun.create({ data: { shop, kind, error: message.slice(0, 400) } }).catch(() => {});
    return { ok: false, error: message };
  }
}

/** One full check (Files + the published theme's files). Safe to run as often as you like. */
export async function runStoreSnapshot(admin, shop) {
  const files = await snapshotKind(admin, shop, "file");
  const themeFiles = await snapshotKind(admin, shop, "theme-file");
  return { files, themeFiles };
}
