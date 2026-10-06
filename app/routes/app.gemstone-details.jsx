/**
 * "Gemstone details": set metal, finger, day, mantra and substitute for each stone. These values are
 * used wherever a recommendation is shown -- the form's result page, the emailed result link, the
 * recommendation email and WhatsApp -- because they're applied when the recommendation is built
 * (see buildGemInfo in app/utils/astroAdvice.server.js). Leave a field blank to keep the automatic
 * value (shown as the grey hint). See app/utils/gemStoneDetails.server.js.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getGemStoneRows, saveGemStoneDetails } from "../utils/gemStoneDetails.server";
import { Card, PageHeader, PageIn, brand } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { rows: await getGemStoneRows(session.shop) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let incoming;
  try {
    incoming = JSON.parse(form.get("rows") || "{}");
  } catch {
    return { ok: false, error: "Could not read the form" };
  }
  try {
    await saveGemStoneDetails(session.shop, incoming);
    return { ok: true, message: "Saved. New recommendations will use these details." };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};

const FIELDS = [
  { id: "metal", label: "Metal", list: null },
  { id: "finger", label: "Finger", list: "gd-fingers" },
  { id: "day", label: "Day", list: "gd-days" },
  { id: "mantra", label: "Mantra", list: null },
  { id: "substitute", label: "Substitute", list: null },
];
const FINGERS = ["Index", "Middle", "Ring", "Little"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: "8px",
  border: `1px solid ${brand.border}`,
  fontSize: "12.5px",
  background: "#fff",
  color: brand.ink,
};
const btnPrimary = {
  padding: "9px 18px",
  borderRadius: "9px",
  border: "none",
  background: brand.accent,
  color: "#fff",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

export default function GemstoneDetailsPage() {
  const { rows } = useLoaderData();
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";
  const [state, setState] = useState(() => Object.fromEntries(rows.map((r) => [r.key, { ...r.values }])));

  useEffect(() => {
    if (fetcher.data?.message) toast.show(fetcher.data.message);
    else if (fetcher.data?.error) toast.show(fetcher.data.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const set = (key, field, value) => setState((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const save = () => fetcher.submit({ rows: JSON.stringify(state) }, { method: "POST" });

  return (
    <PageIn>
      <PageHeader
        title="Gemstone details"
        description="Set the metal, finger, day, mantra and substitute shown for each stone on the recommendation result page, in the emailed result link, and in the email and WhatsApp messages."
      />

      <Card style={{ marginBottom: "14px" }}>
        <p style={{ margin: "0 0 12px", fontSize: "12.5px", color: brand.body, lineHeight: 1.55 }}>
          Whatever you type here replaces the automatic value for that stone. <strong>Leave a field blank</strong> to keep the
          automatic one (shown in grey). Weight is not set here; it still comes from the customer&rsquo;s chart. Changes apply to
          new recommendations from the moment you save.
        </p>
        <button type="button" style={btnPrimary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </Card>

      <datalist id="gd-fingers">{FINGERS.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id="gd-days">{DAYS.map((d) => <option key={d} value={d} />)}</datalist>

      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: brand.muted }}>Stone</th>
                {FIELDS.map((f) => (
                  <th key={f.id} style={{ textAlign: "left", padding: "8px 6px", fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: brand.muted }}>
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: `1px solid ${brand.border}` }}>
                  <td style={{ padding: "10px", verticalAlign: "top", minWidth: "170px" }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: brand.ink }}>
                      {r.name} <span style={{ fontWeight: 400, fontStyle: "italic", color: brand.muted }}>({r.hindi})</span>
                    </div>
                    <div style={{ fontSize: "11.5px", color: brand.muted }}>for {r.planet}</div>
                  </td>
                  {FIELDS.map((f) => (
                    <td key={f.id} style={{ padding: "8px 6px", verticalAlign: "top", minWidth: "150px" }}>
                      <input
                        style={inputStyle}
                        type="text"
                        list={f.list || undefined}
                        value={state[r.key]?.[f.id] ?? ""}
                        onChange={(e) => set(r.key, f.id, e.target.value)}
                        placeholder={r.defaults[f.id] || "Automatic"}
                        aria-label={`${r.name} ${f.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: "14px" }}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save details"}
          </button>
        </div>
      </Card>
    </PageIn>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
