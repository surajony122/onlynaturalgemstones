/**
 * "Store activity" page: a permanent record of things deleted in the Shopify
 * store -- pictures/files, products, collections, customers, themes and the
 * published theme's files -- so the merchant can see what disappeared and
 * when. Webhook entries carry the exact time (and who, when Shopify says);
 * Files have no webhook, so they're found by comparing a saved list with the
 * current one (see app/utils/storeActivity.server.js).
 */
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runStoreSnapshot } from "../utils/storeActivity.server";
import { backupIndex } from "../utils/designImages.server";
import { brand, Card, PageHeader, PageIn, Pill, MultiSelect, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";

const KIND_LABELS = { file: "Picture / file", product: "Product", collection: "Collection", customer: "Customer", theme: "Theme", "theme-file": "Theme file" };
const KIND_COLORS = { file: "#c0392b", product: "#b06000", collection: "#7b5ea7", customer: "#2e6f95", theme: "#5f6368", "theme-file": "#8c7960" };

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const kinds = (url.searchParams.get("kind") || "").split(",").filter(Boolean);
  const where = { shop, ...(kinds.length ? { kind: { in: kinds } } : {}) };
  const [events, total, runFile, runTheme] = await Promise.all([
    prisma.storeDeletionEvent.findMany({ where, orderBy: { detectedAt: "desc" }, take: 500 }),
    prisma.storeDeletionEvent.count({ where: { shop } }),
    prisma.storeSnapshotRun.findFirst({ where: { shop, kind: "file" }, orderBy: { ranAt: "desc" } }),
    prisma.storeSnapshotRun.findFirst({ where: { shop, kind: "theme-file" }, orderBy: { ranAt: "desc" } }),
  ]);
  const backup = backupIndex();
  return {
    total,
    runs: { file: runFile, themeFile: runTheme },
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      resourceId: e.resourceId,
      source: e.source,
      actor: e.actor,
      note: e.note,
      happenedAt: e.happenedAt ? e.happenedAt.toISOString() : null,
      windowStart: e.windowStart ? e.windowStart.toISOString() : null,
      detectedAt: e.detectedAt.toISOString(),
      hasBackup: (e.kind === "file" || e.kind === "theme-file") && !!e.title && backup.has(e.title.replace(/^assets\//, "")),
    })),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "runCheck") return { ok: false, error: "Unknown action" };
  try {
    const result = await runStoreSnapshot(admin, session.shop);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};

const fmt = (iso) => new Date(iso).toLocaleString();

function runLine(label, run) {
  if (!run) return `${label}: not checked yet`;
  if (run.error) return `${label}: last check failed (${run.error.slice(0, 90)})`;
  return `${label}: ${run.itemCount} items, last checked ${fmt(run.ranAt)}${run.baseline ? " (first check: saved as the starting list)" : ""}`;
}

export default function StoreActivityPage() {
  const { events, total, runs } = useLoaderData();
  const fetcher = useFetcher();
  const [params, setParams] = useSearchParams();
  const selected = (params.get("kind") || "").split(",").filter(Boolean);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.ok ? fetcher.data.result : null;
  const needsPermission = [runs.file, runs.themeFile, result?.files, result?.themeFiles].some((r) => /access|scope|permission|denied/i.test(String(r?.error || "")));

  const setKinds = (next) => {
    const p = new URLSearchParams(params);
    if (next.length) p.set("kind", next.join(","));
    else p.delete("kind");
    setParams(p);
  };

  return (
    <PageIn>
      <PageHeader
        title="Store activity"
        description="A permanent record of things deleted in your Shopify store, so you can see what happened and when."
        stats={[
          { label: "Deletions recorded", value: total, tone: total > 0 ? "danger" : undefined },
          { label: "Shown", value: events.length },
        ]}
        actions={
          <button
            type="button"
            disabled={busy}
            onClick={() => fetcher.submit({ intent: "runCheck" }, { method: "post" })}
            style={{ padding: "8px 14px", borderRadius: "9px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "13px", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Checking…" : "Check files now"}
          </button>
        }
        info={
          <p style={{ margin: 0 }}>
            Products, collections, customers and themes are recorded the moment Shopify reports them deleted. Shopify has no notice for
            deleted files or pictures, so the app compares a saved list of your files with the current one every time the scheduled check runs.
            A deleted file is shown with the time window it vanished in. Shopify does not say who deleted a file.
          </p>
        }
      />

      {needsPermission && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            The app does not have permission to read your Files yet. Approve the new "read files" permission in Shopify admin (the app update prompt), then press "Check files now".
          </p>
        </Card>
      )}
      {fetcher.data && !fetcher.data.ok && (
        <Card style={{ marginBottom: "16px", background: "#fdeeee", borderColor: "#e7b5b5" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.danger }}>Couldn't run the check: {fetcher.data.error}</p>
        </Card>
      )}
      {result && (
        <Card style={{ marginBottom: "16px" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
            Files: {result.files.ok ? `${result.files.total} found, ${result.files.deleted} newly missing${result.files.baseline ? " (first check, saved as the starting list)" : ""}` : `failed (${String(result.files.error).slice(0, 120)})`}.{" "}
            Theme files: {result.themeFiles.ok ? `${result.themeFiles.total} found, ${result.themeFiles.deleted} newly missing${result.themeFiles.baseline ? " (first check, saved as the starting list)" : ""}` : `failed (${String(result.themeFiles.error).slice(0, 120)})`}.
          </p>
        </Card>
      )}

      <Card style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", color: brand.muted, lineHeight: 1.7 }}>
          <div>{runLine("Files", runs.file)}</div>
          <div>{runLine("Published theme's files", runs.themeFile)}</div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <MultiSelect
          label="type"
          options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
          selected={selected}
          onChange={setKinds}
        />
      </div>

      {events.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontSize: "13px", color: brand.muted }}>
            {total === 0
              ? "Nothing deleted since this log started. New deletions will appear here."
              : "No deletions of this type."}
          </p>
        </Card>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>When</th>
                <th style={thStyle}>What</th>
                <th style={thStyle}>Who</th>
                <th style={thStyle}>How we know</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="dt-row">
                  <td style={{ ...tdStyle, minWidth: "200px" }}>
                    {e.happenedAt ? (
                      <div style={{ fontWeight: 600, color: brand.ink }}>{fmt(e.happenedAt)}</div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, color: brand.ink }}>Found {fmt(e.detectedAt)}</div>
                        {e.windowStart && <div style={{ fontSize: "11px", color: brand.muted }}>It was there at {fmt(e.windowStart)}, so it was deleted between then and now.</div>}
                      </>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <Pill label={KIND_LABELS[e.kind] || e.kind} active color={KIND_COLORS[e.kind] || brand.muted} />
                    <div style={{ fontWeight: 600, color: brand.ink, marginTop: "4px", wordBreak: "break-all" }}>{e.title || e.resourceId || "Unknown"}</div>
                    {e.detail && e.detail !== e.title && <div style={{ fontSize: "11px", color: brand.muted, wordBreak: "break-all" }}>{e.detail}</div>}
                    {e.hasBackup && <div style={{ fontSize: "11px", color: brand.success, marginTop: "3px" }}>A saved copy exists in the app's design-images folder.</div>}
                    {e.note && <div style={{ fontSize: "11px", color: brand.muted, marginTop: "3px" }}>{e.note}</div>}
                  </td>
                  <td style={tdStyle}>{e.actor ? e.actor : <span style={{ color: brand.muted, fontSize: "12px" }}>Shopify did not say</span>}</td>
                  <td style={{ ...tdStyle, fontSize: "12px", color: brand.body }}>{e.source === "webhook" ? "Shopify reported it" : "Missing from the saved list"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
