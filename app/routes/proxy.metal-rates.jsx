/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/metal-rates
 * (routed via [app_proxy] in shopify.app.toml, same as proxy.jsx — Shopify
 * signs every request that reaches this URL through the proxy, and
 * authenticate.public.appProxy() verifies that signature, so this only
 * ever runs for requests that genuinely came through the customer's own
 * store.)
 *
 * Serves the metal rates + making charge + tax rate saved on this app's
 * own dashboard (app._index.jsx's "Daily Metal Rates & Pricing Formula"
 * panel) to the storefront, replacing the theme's shubh_rate_* Theme
 * Settings as the live pricing source per explicit request — the theme
 * (shubh-gems-customizer.js) fetches this once on page load and, if it
 * succeeds, overrides the Theme-Settings-sourced rates with these. If
 * this fetch fails for any reason, the theme silently keeps using its
 * own Theme Settings values instead, so nothing on the storefront
 * breaks if this app is ever uninstalled or unreachable.
 *
 * Response (JSON), in the exact shape window.shubhConfig.rates /
 * window.shubhConfig.makingCharge / .taxRate already use on the theme
 * side, so the theme-side change is a small, drop-in override:
 * {
 *   rates: {
 *     "Silver": ..., "Panchdhatu": ..., "Tamba (Copper)": ...,
 *     "22K Yellow Gold": ..., "18K Yellow Gold": ..., "18K White Gold": ...,
 *     "14K Yellow Gold": ..., "14K White Gold": ...
 *   },
 *   makingCharge: ...,
 *   taxRate: ...
 * }
 */
import { authenticate } from "../shopify.server";
import { getAppSettings, ratesFromAppSettings } from "../utils/appSettings.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin) {
    // Same "fail closed" reasoning as proxy.jsx / proxy.places-autocomplete.jsx.
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  const settings = await getAppSettings(session.shop);
  const rates = ratesFromAppSettings(settings);

  return Response.json({
    rates: {
      Silver: rates.silver,
      Panchdhatu: rates.panchdhatu,
      "Tamba (Copper)": rates.copper,
      "22K Yellow Gold": rates["22k-yellow"],
      "18K Yellow Gold": rates["18k-yellow"],
      "18K White Gold": rates["18k-white"],
      "14K Yellow Gold": rates["14k-yellow"],
      "14K White Gold": rates["14k-white"],
    },
    makingCharge: rates.makingCharge,
    taxRate: rates.taxRate,
  });
};
