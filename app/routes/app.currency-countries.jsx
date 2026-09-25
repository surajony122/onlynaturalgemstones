/**
 * "Currency by country": choose which countries the storefront currency selector serves and which currency each
 * one gets. Continents -> countries -> [on/off] [currency]. Saving keeps the choices in the app; Publish writes them
 * into the chosen theme (snippets/shubh-currency-config.liquid), which the storefront script reads. Prices are
 * converted for display only; checkout stays in INR. See app/utils/currencyCountries.server.js.
 */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CURRENCY_OPTIONS,
  describeContinents,
  getCurrencyCountryConfig,
  saveCurrencyCountryConfig,
  listThemes,
  publishCurrencyConfigToTheme,
  readPublishedConfig,
  compareWithPublished,
} from "../utils/currencyCountries.server";
import { Card, PageHeader, PageIn, brand } from "../components/table-kit";
import { useToast } from "../components/toast";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const cfg = await getCurrencyCountryConfig(session.shop);
  let themes = [];
  try { themes = await listThemes(admin); } catch { themes = []; }
  // Sync check: what each of the live theme and the default test theme currently holds vs what is saved here.
  const targets = [];
  const live = themes.find((t) => t.role === "MAIN");
  const test = themes.find((t) => /test/i.test(t.name)) || themes.find((t) => t.role !== "MAIN");
  if (live) targets.push(live);
  if (test && test.id !== live?.id) targets.push(test);
  const sync = [];
  for (const t of targets) {
    try {
      sync.push({ id: t.id, name: t.name, live: t.role === "MAIN", ...compareWithPublished(cfg, await readPublishedConfig(admin, t.id)) });
    } catch (err) {
      sync.push({ id: t.id, name: t.name, live: t.role === "MAIN", state: "error", detail: "Could not read this theme" });
    }
  }
  return { continents: describeContinents(), cfg, currencies: CURRENCY_OPTIONS, themes, sync };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  let incoming;
  try { incoming = JSON.parse(form.get("countries") || "{}"); } catch { return { intent, ok: false, error: "Could not read the form" }; }

  try {
    const cfg = await saveCurrencyCountryConfig(session.shop, { countries: incoming });
    if (intent === "save") return { intent, ok: true, message: "Saved" };
    if (intent === "publish") {
      const themeId = form.get("themeId");
      if (!themeId) return { intent, ok: false, error: "Pick a theme to publish to" };
      const themes = await listThemes(admin);
      const theme = themes.find((t) => t.id === themeId);
      await publishCurrencyConfigToTheme(admin, themeId, cfg);
      return { intent, ok: true, message: `Saved and published to "${theme ? theme.name : "theme"}"${theme?.role === "MAIN" ? " (LIVE)" : ""}` };
    }
    return { intent, ok: false, error: "Unknown action" };
  } catch (err) {
    return { intent, ok: false, error: String((err && err.message) || err) };
  }
};

const selectStyle = { padding: "6px 8px", borderRadius: "8px", border: `1px solid ${brand.border}`, fontSize: "12.5px", background: "#fff", color: brand.ink, maxWidth: "230px" };
const btn = { padding: "9px 16px", borderRadius: "9px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "13px", fontWeight: 500, cursor: "pointer" };
const btnPrimary = { ...btn, border: "none", background: brand.accent, color: "#fff", fontWeight: 600 };

function Flag({ iso }) {
  return <img src={`https://flagcdn.com/20x15/${iso.toLowerCase()}.png`} width="20" height="15" alt="" style={{ borderRadius: "2px", verticalAlign: "middle" }} loading="lazy" />;
}

function ContinentBlock({ continent, state, setState, currencies, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [bulkCurrency, setBulkCurrency] = useState("");
  const total = continent.countries.length;
  const onCount = continent.countries.filter((c) => state[c.code]?.enabled).length;

  const patch = (codes, change) =>
    setState((prev) => {
      const next = { ...prev };
      codes.forEach((cc) => { next[cc] = { ...next[cc], ...change }; });
      return next;
    });

  return (
    <Card style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 700, color: brand.ink, padding: 0 }}>
          {open ? "▾" : "▸"} {continent.name}
        </button>
        <span style={{ fontSize: "12.5px", color: brand.muted }}>
          {total === 0 ? "No countries — nothing here is served" : `${onCount} of ${total} countries on`}
        </span>
        {total > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={btn} onClick={() => patch(continent.countries.map((c) => c.code), { enabled: true })}>All on</button>
            <button type="button" style={btn} onClick={() => patch(continent.countries.map((c) => c.code), { enabled: false })}>All off</button>
            <select style={selectStyle} value={bulkCurrency} onChange={(e) => setBulkCurrency(e.target.value)} aria-label={`Currency for all of ${continent.name}`}>
              <option value="">Set one currency for all…</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.name}</option>)}
            </select>
            <button type="button" style={btn} disabled={!bulkCurrency} onClick={() => patch(continent.countries.map((c) => c.code), { currency: bulkCurrency })}>Apply</button>
          </div>
        )}
      </div>

      {open && total > 0 && (
        <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "6px 18px" }}>
          {continent.countries.map((c) => {
            const v = state[c.code] || { enabled: false, currency: "" };
            return (
              <div key={c.code} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "4px 0", borderBottom: `1px solid ${brand.border}` }}>
                <input type="checkbox" checked={v.enabled} onChange={(e) => patch([c.code], { enabled: e.target.checked })} aria-label={`Serve ${c.name}`} />
                <Flag iso={c.code} />
                <span style={{ flex: 1, fontSize: "13px", color: v.enabled ? brand.ink : brand.muted }}>{c.name}</span>
                <select style={selectStyle} value={v.currency} onChange={(e) => patch([c.code], { currency: e.target.value })} aria-label={`Currency for ${c.name}`}>
                  <option value="">— none (stays INR) —</option>
                  {currencies.map((cu) => <option key={cu.code} value={cu.code}>{cu.code} - {cu.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function CurrencyCountriesPage() {
  const { continents, cfg, currencies, themes, sync } = useLoaderData();
  const [state, setState] = useState(cfg.countries);
  const fetcher = useFetcher();
  const toast = useToast();
  const busy = fetcher.state !== "idle";

  const defaultTheme = useMemo(() => {
    const test = themes.find((t) => /test/i.test(t.name));
    return (test || themes.find((t) => t.role !== "MAIN") || themes[0] || {}).id || "";
  }, [themes]);
  const [themeId, setThemeId] = useState(defaultTheme);
  const targetTheme = themes.find((t) => t.id === themeId);

  useEffect(() => {
    if (fetcher.data?.message) toast.show(fetcher.data.message);
    else if (fetcher.data?.error) toast.show(fetcher.data.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const submit = (intent) => fetcher.submit({ intent, countries: JSON.stringify(state), themeId }, { method: "POST" });
  const totals = useMemo(() => {
    const on = Object.values(state).filter((v) => v.enabled && v.currency);
    return { countries: on.length, currencies: new Set(on.map((v) => v.currency)).size };
  }, [state]);

  return (
    <PageIn>
      <PageHeader
        title="Currency by country"
        description="Choose which countries the storefront currency selector serves and which currency each country gets. Prices are converted from INR for display; checkout is always charged in INR."
      />

      <Card style={{ marginBottom: "14px" }}>
        <p style={{ margin: "0 0 10px", fontSize: "12.5px", color: brand.body, lineHeight: 1.5 }}>
          A visitor's country is detected from their IP. If that country is <strong>on</strong> here and has a currency, they're
          switched to it on their first visit. A country that's <strong>off</strong> (or has no currency) is left on INR. The
          dropdown on the website lists INR plus every currency used by a country that's on ({totals.countries} countries, {totals.currencies} currencies now).
          Exchange rates update automatically.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={btn} disabled={busy} onClick={() => submit("save")}>Save</button>
          <span style={{ fontSize: "12.5px", color: brand.muted }}>or save and publish to</span>
          <select style={{ ...selectStyle, maxWidth: "300px" }} value={themeId} onChange={(e) => setThemeId(e.target.value)} aria-label="Theme to publish to">
            {themes.length === 0 && <option value="">No themes found</option>}
            {themes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role === "MAIN" ? "LIVE" : t.role.toLowerCase()})</option>)}
          </select>
          <button type="button" style={btnPrimary} disabled={busy || !themeId} onClick={() => submit("publish")}>
            {busy ? "Working…" : targetTheme?.role === "MAIN" ? "Save & publish to LIVE" : "Save & publish"}
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "12px", color: brand.muted }}>
          Publishing writes one small file to the chosen theme. Try it on your TEST theme first, then publish to the live theme.
        </p>
      </Card>

      <Card style={{ marginBottom: "14px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 8px", color: brand.ink }}>Is the website up to date?</h2>
        <p style={{ margin: "0 0 10px", fontSize: "12.5px", color: brand.muted, lineHeight: 1.5 }}>
          The website only changes when you click <strong>Save &amp; publish</strong>. This compares what is <strong>saved here</strong> (last time you saved) with what each theme currently holds.
          Changes you have made on this page but not saved yet are not counted.
        </p>
        {sync.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "6px 0", borderTop: `1px solid ${brand.border}`, flexWrap: "wrap" }}>
            <strong style={{ fontSize: "13px", minWidth: "220px" }}>{s.name} {s.live ? "(LIVE)" : ""}</strong>
            <span style={{ fontSize: "13px", color: s.state === "synced" ? brand.success : s.state === "differs" || s.state === "error" ? brand.danger : brand.muted }}>
              {s.state === "synced" ? "✓ " : s.state === "differs" ? "⚠ Out of date — " : ""}{s.detail}
            </span>
            {s.diffs && (
              <div style={{ width: "100%", fontSize: "12px", color: brand.muted }}>
                {s.diffs.join("  ·  ")}{s.more ? `  ·  …and ${s.more} more` : ""}
              </div>
            )}
          </div>
        ))}
        {sync.length === 0 && <span style={{ fontSize: "12.5px", color: brand.muted }}>No themes found.</span>}
      </Card>

      {continents.map((c, i) => (
        <ContinentBlock key={c.id} continent={c} state={state} setState={setState} currencies={currencies} defaultOpen={i < 0} />
      ))}
    </PageIn>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
