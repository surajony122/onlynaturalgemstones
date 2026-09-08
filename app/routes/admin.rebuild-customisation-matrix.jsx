/**
 * One-off trigger to rebuild the Gemstone Customisation variant matrix
 * (same effect as clicking "Save Rates & Rebuild Customisation Matrix"
 * in the app's own admin screen) from outside an interactive Shopify
 * staff session -- used here specifically to make the Rs-1 "Utility"
 * surcharge-fallback fix (see gemstoneCustomisationMatrix.server.js)
 * take effect on the live snippet without waiting for a merchant to
 * click the button. Uses the shop's already-saved metal rates (does
 * NOT reset them to defaults) -- see app._index.jsx's own
 * rebuildCustomisationMatrix action for the equivalent UI-driven path.
 *
 * NOT a permanent standing endpoint -- delete this file once the
 * rebuild it was created for has run and been confirmed.
 *
 *   GET /admin/rebuild-customisation-matrix?secret=<REBUILD_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { getAppSettings, ratesFromAppSettings } from "../utils/appSettings.server";
import { buildGemstoneCustomisationMatrix } from "../utils/gemstoneCustomisationMatrix.server";

const REBUILD_SECRET = "8f13c2e9a06d47b5b8e1c4f9d2a37065e4b1c8a9f0d2e3c7";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== REBUILD_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ error: "No shop installed" }, { status: 500 });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const settings = await getAppSettings(session.shop);
    const rates = ratesFromAppSettings(settings);
    const result = await buildGemstoneCustomisationMatrix(admin, rates);
    return Response.json({ ok: true, ratesUsed: rates, ...result });
  } catch (err) {
    console.error("[admin.rebuild-customisation-matrix] failed:", err);
    return Response.json({ error: String(err && err.message || err) }, { status: 500 });
  }
};
