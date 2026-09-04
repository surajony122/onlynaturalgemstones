/**
 * TEMPORARY one-off trigger for the same "Save Rates & Rebuild
 * Customisation Matrix" action as the button in app._index.jsx — added
 * only to run that rebuild once, immediately, from outside the embedded
 * admin UI (no interactive Shopify staff session was available at the
 * time). Uses the currently-SAVED rates (does not change them), same as
 * clicking the button without editing any rate field first.
 *
 * Mirrors admin.migrate-design-variants.jsx's existing secret-URL
 * pattern exactly (own hardcoded secret, unauthenticated.admin()) rather
 * than introducing a new auth approach.
 *
 * DELETE THIS FILE after use — it is not meant to be a permanent
 * standing endpoint like migrate-design-variants.jsx is.
 *
 *   GET /admin/rebuild-customisation-matrix?secret=<SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { buildGemstoneCustomisationMatrix } from "../utils/gemstoneCustomisationMatrix.server";
import { getAppSettings, ratesFromAppSettings } from "../utils/appSettings.server";

const SECRET = "3f9a2c7e5b18d4406af9c2e17b5d0a3c9e8f61d2b7";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== SECRET) {
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
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
