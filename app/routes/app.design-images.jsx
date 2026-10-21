/**
 * "Design images" health page: checks that every picture the product page's
 * design chooser uses still loads, and whether a saved copy exists in this
 * app's design-images folder. Read-only -- safe to open any time. Pictures
 * live in Shopify Files, which has lost some without warning, so this shows
 * a loss the same day instead of when a customer sees a broken card.
 */
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticatePage } from "../utils/teamAccess.server";
import { getDesignImageReport } from "../utils/designImages.server";
import { brand, Card, PageHeader, PageIn, Pill, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";

export const loader = async ({ request }) => {
  const { admin } = await authenticatePage(request, "designimages");
  try {
    return { report: await getDesignImageReport(admin), error: null };
  } catch (err) {
    return { report: null, error: String((err && err.message) || err) };
  }
};

export default function DesignImagesPage() {
  const { report, error } = useLoaderData();
  const revalidator = useRevalidator();
  const checking = revalidator.state !== "idle";

  return (
    <PageIn>
      <PageHeader
        title="Design images"
        description="Checks every picture in the product page's design chooser and whether a saved copy exists."
        stats={report && report.ok ? [
          { label: "Checked", value: report.total },
          { label: "Working", value: report.working, tone: "success" },
          { label: "Not loading", value: report.broken, tone: report.broken > 0 ? "danger" : undefined },
          { label: "Saved copies", value: report.backupAvailable ? report.backupCount : "—" },
        ] : []}
        actions={
          <button
            type="button"
            onClick={() => revalidator.revalidate()}
            disabled={checking}
            style={{ padding: "8px 14px", borderRadius: "9px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "13px", fontWeight: 600, cursor: checking ? "default" : "pointer", opacity: checking ? 0.6 : 1 }}
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        }
        info={
          <p style={{ margin: 0 }}>
            Reads the list from your published theme ("{report?.themeName || "…"}") and tests each picture. If one is not loading,
            upload its saved copy from the app's design-images folder to Shopify admin → Content → Files under exactly the same name.
          </p>
        }
      />

      {error && (
        <Card style={{ marginBottom: "16px", background: "#fdeeee", borderColor: "#e7b5b5" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.danger }}>Couldn't run the check: {error}</p>
        </Card>
      )}
      {report && !report.ok && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>{report.error}</p>
        </Card>
      )}

      {report && report.ok && (
        <>
          <Card style={{ marginBottom: "16px", background: report.broken > 0 ? "#fdeeee" : "#eef7ef", borderColor: report.broken > 0 ? "#e7b5b5" : "#b9dcbf" }}>
            <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>
              {report.broken > 0
                ? `${report.broken} picture${report.broken === 1 ? " is" : "s are"} not loading. They are listed first below.`
                : `All ${report.total} pictures are loading.`}
              {!report.backupAvailable && " (The saved copies were not found on this server, so the Saved copy column shows No.)"}
              <span style={{ color: brand.muted }}> Checked {new Date(report.checkedAt).toLocaleString()}.</span>
            </p>
          </Card>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Picture</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Designs</th>
                  <th style={thStyle}>Saved copy</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.name + r.kind} className="dt-row">
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: brand.ink, wordBreak: "break-all" }}>{r.name}</div>
                      <div style={{ fontSize: "11px", color: brand.muted }}>{r.kind === "files" ? "Shopify Files" : "Stored in the theme"} · used {r.uses}×</div>
                    </td>
                    <td style={tdStyle}>
                      <Pill label={r.ok ? "Loading" : "Not loading"} active color={r.ok ? brand.success : brand.danger} />
                      {!r.ok && <div style={{ fontSize: "11px", color: brand.muted, marginTop: "3px" }}>{r.detail}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: "12px", color: brand.body }}>{r.designs.join(", ") || "—"}</td>
                    <td style={tdStyle}>
                      <Pill label={r.backedUp ? "Yes" : "No"} active color={r.backedUp ? brand.success : brand.muted} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
