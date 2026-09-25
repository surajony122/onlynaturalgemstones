/**
 * Country -> currency control for the storefront currency selector.
 *
 * The merchant picks, per country, whether the country is switched on and which currency it gets (the
 * "Currency by country" app page). Saving stores the choices in AppSettings.currencyCountryConfig, and
 * "Publish" writes them into the theme as snippets/shubh-currency-config.liquid, which
 * assets/shubh-currency-convert.js reads to (a) build the flag list of currencies and (b) pick a currency
 * from the visitor's IP country. Prices are converted for display only; checkout stays in INR.
 */
import { getAppSettings, saveAppSettings } from "./appSettings.server";

/** code, country whose flag is shown */
export const CURRENCIES = [
  ["INR", "in"], ["USD", "us"], ["EUR", "eu"], ["GBP", "gb"], ["AUD", "au"], ["CAD", "ca"], ["NZD", "nz"],
  ["AED", "ae"], ["SAR", "sa"], ["QAR", "qa"], ["KWD", "kw"], ["BHD", "bh"], ["OMR", "om"], ["JOD", "jo"],
  ["ILS", "il"], ["EGP", "eg"], ["TRY", "tr"], ["SGD", "sg"], ["MYR", "my"], ["HKD", "hk"], ["JPY", "jp"],
  ["KRW", "kr"], ["CNY", "cn"], ["TWD", "tw"], ["IDR", "id"], ["PHP", "ph"], ["VND", "vn"], ["THB", "th"],
  ["BND", "bn"], ["MVR", "mv"], ["LKR", "lk"], ["NPR", "np"], ["BDT", "bd"], ["PKR", "pk"], ["KZT", "kz"],
  ["CHF", "ch"], ["SEK", "se"], ["NOK", "no"], ["DKK", "dk"], ["ISK", "is"], ["PLN", "pl"], ["CZK", "cz"],
  ["HUF", "hu"], ["RON", "ro"], ["BGN", "bg"], ["UAH", "ua"], ["ZAR", "za"], ["MUR", "mu"], ["NGN", "ng"],
  ["KES", "ke"], ["GHS", "gh"], ["MAD", "ma"], ["BRL", "br"], ["MXN", "mx"], ["ARS", "ar"], ["CLP", "cl"],
  ["COP", "co"], ["PEN", "pe"],
];

const currencyName = (() => {
  let dn;
  try { dn = new Intl.DisplayNames(["en"], { type: "currency" }); } catch { dn = null; }
  return (code) => (dn && dn.of(code)) || code;
})();

export const CURRENCY_OPTIONS = CURRENCIES.map(([code, flag]) => ({ code, flag, name: currencyName(code) }));

/** Countries by continent (ISO 3166-1 alpha-2). Antarctica is kept empty on purpose: nothing is sold there. */
export const CONTINENTS = [
  {
    id: "africa",
    name: "Africa",
    countries: "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  },
  {
    id: "antarctica",
    name: "Antarctica",
    countries: "",
  },
  {
    id: "asia",
    name: "Asia",
    countries: "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE",
  },
  {
    id: "europe",
    name: "Europe",
    countries: "AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB AX",
  },
  {
    id: "north-america",
    name: "North America",
    countries: "AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI UM",
  },
  {
    id: "south-america",
    name: "South America",
    countries: "AR BO BR CL CO EC FK GF GY PY PE SR UY VE",
  },
  {
    id: "oceania",
    name: "Oceania",
    countries: "AS AU CX CC CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF",
  },
].map((c) => ({ ...c, countries: c.countries ? c.countries.split(/\s+/) : [] }));

const countryName = (() => {
  let dn;
  try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch { dn = null; }
  return (code) => {
    try { return (dn && dn.of(code)) || code; } catch { return code; }
  };
})();

/** Suggested currency for a country (used to pre-fill; only currencies the app offers). */
const SUGGESTED = {};
function suggest(code, countries) { countries.split(/\s+/).forEach((c) => (SUGGESTED[c] = code)); }
suggest("INR", "IN");
suggest("USD", "US PR GU VI AS MP UM");
suggest("EUR", "DE FR IT ES NL BE AT IE PT FI GR LU MT CY SK SI EE LV LT HR AD MC SM VA ME XK");
suggest("GBP", "GB GG JE IM");
suggest("CAD", "CA"); suggest("AUD", "AU CX CC NF"); suggest("NZD", "NZ CK NU TK");
suggest("AED", "AE"); suggest("SAR", "SA"); suggest("QAR", "QA"); suggest("KWD", "KW"); suggest("BHD", "BH");
suggest("OMR", "OM"); suggest("JOD", "JO"); suggest("ILS", "IL"); suggest("EGP", "EG"); suggest("TRY", "TR");
suggest("SGD", "SG"); suggest("MYR", "MY"); suggest("HKD", "HK"); suggest("JPY", "JP"); suggest("KRW", "KR");
suggest("CNY", "CN"); suggest("TWD", "TW"); suggest("IDR", "ID"); suggest("PHP", "PH"); suggest("VND", "VN");
suggest("THB", "TH"); suggest("BND", "BN"); suggest("MVR", "MV"); suggest("LKR", "LK"); suggest("NPR", "NP");
suggest("BDT", "BD"); suggest("PKR", "PK"); suggest("KZT", "KZ"); suggest("CHF", "CH LI");
suggest("SEK", "SE"); suggest("NOK", "NO SJ"); suggest("DKK", "DK FO GL"); suggest("ISK", "IS");
suggest("PLN", "PL"); suggest("CZK", "CZ"); suggest("HUF", "HU"); suggest("RON", "RO"); suggest("BGN", "BG");
suggest("UAH", "UA"); suggest("ZAR", "ZA"); suggest("MUR", "MU"); suggest("NGN", "NG"); suggest("KES", "KE");
suggest("GHS", "GH"); suggest("MAD", "MA"); suggest("BRL", "BR"); suggest("MXN", "MX"); suggest("ARS", "AR");
suggest("CLP", "CL"); suggest("COP", "CO"); suggest("PEN", "PE");

/** Countries switched ON the first time the page is opened: the ones the store already served before this page existed. */
const DEFAULT_ON =
  "IN DE FR IT ES NL BE AT IE PT FI GR LU MT CY SK SI EE LV LT HR GB US CA AU NZ AE SA QA KW BH OM SG MY HK JP CH ID IL MU PH VN".split(
    " "
  );

const OFFERED = new Set(CURRENCIES.map(([c]) => c));

function defaultConfig() {
  const countries = {};
  for (const cont of CONTINENTS) {
    for (const cc of cont.countries) {
      countries[cc] = { enabled: DEFAULT_ON.includes(cc), currency: SUGGESTED[cc] || "" };
    }
  }
  return { countries };
}

/** Saved choices merged over the defaults; unknown countries/currencies are dropped. */
export function normalizeConfig(saved) {
  const base = defaultConfig();
  const src = saved && typeof saved === "object" ? saved.countries || {} : {};
  for (const cc of Object.keys(base.countries)) {
    const s = src[cc];
    if (!s || typeof s !== "object") continue;
    const cur = String(s.currency || "").toUpperCase();
    base.countries[cc] = { enabled: !!s.enabled, currency: OFFERED.has(cur) ? cur : "" };
  }
  return base;
}

export async function getCurrencyCountryConfig(shop) {
  const settings = await getAppSettings(shop);
  let parsed = null;
  try { parsed = settings.currencyCountryConfig ? JSON.parse(settings.currencyCountryConfig) : null; } catch { parsed = null; }
  return normalizeConfig(parsed);
}

export async function saveCurrencyCountryConfig(shop, incoming) {
  const cfg = normalizeConfig(incoming);
  await saveAppSettings(shop, { currencyCountryConfig: JSON.stringify({ countries: cfg.countries }) });
  return cfg;
}

/** Data for the page: continents with named countries. */
export function describeContinents() {
  return CONTINENTS.map((c) => ({
    id: c.id,
    name: c.name,
    countries: c.countries.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/**
 * What the storefront needs: the currencies to list (INR always first, then every currency used by a switched-on
 * country, in the master order) and {COUNTRY: CURRENCY} for switched-on countries that have a currency. A country that
 * is switched off (or blank) simply isn't in the map, so a visitor from there stays on INR.
 */
export function buildThemeConfig(cfg) {
  const used = new Set(["INR"]);
  const countries = {};
  for (const [cc, v] of Object.entries(cfg.countries)) {
    if (v.enabled && v.currency) {
      countries[cc] = v.currency;
      used.add(v.currency);
    }
  }
  const currencies = CURRENCY_OPTIONS.filter((o) => used.has(o.code)).map((o) => ({ code: o.code, flag: o.flag, name: o.name }));
  return { v: 1, currencies, countries };
}

export function themeSnippetBody(themeConfig) {
  // "<" escaped so the JSON can never close its own <script> tag.
  const json = JSON.stringify(themeConfig).replace(/</g, "\\u003c");
  return `{% comment %}Written by the app's "Currency by country" page. Do not edit by hand.{% endcomment %}\n<script type="application/json" id="ShubhCurrencyConfig">${json}</script>\n`;
}

export async function listThemes(admin) {
  const res = await admin.graphql(`#graphql
    query CurrencyThemes { themes(first: 25) { nodes { id name role } } }`);
  const nodes = (await res.json())?.data?.themes?.nodes || [];
  return nodes.map((t) => ({ id: t.id, name: t.name, role: t.role }));
}

export async function publishCurrencyConfigToTheme(admin, themeGid, cfg) {
  const body = themeSnippetBody(buildThemeConfig(cfg));
  const res = await admin.graphql(
    `#graphql
    mutation CurrencyConfigUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles { filename }
        userErrors { field message }
      }
    }`,
    { variables: { themeId: themeGid, files: [{ filename: "snippets/shubh-currency-config.liquid", body: { type: "TEXT", value: body } }] } }
  );
  const json = await res.json();
  const errs = json?.data?.themeFilesUpsert?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  return { bytes: body.length };
}
