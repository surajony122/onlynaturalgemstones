/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/astro-advice
 * (reachable under the SAME [app_proxy] prefix/subpath as proxy.jsx —
 * Shopify only allows one app_proxy block per app, so every public
 * storefront-facing endpoint has to live under /apps/customize/*; the
 * "customize" name is just that fixed prefix, unrelated to what this
 * particular route does).
 *
 * Replaces the old astro-lead-sync-app + Google Apps Script Web App URL
 * — the theme's shubh-astro-advice.js POSTs here now instead. Same
 * request/response JSON shape as the old Apps Script backend on purpose,
 * so the theme JS itself needed zero changes; only the "Apps Script URL"
 * section setting's VALUE needs to change to this route's URL. See
 * MERGE_ASTRO_ADVICE.md.
 */
import { authenticate } from "../shopify.server";
import { handleAstroAdviceSubmission } from "../utils/astroAdvice.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) {
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    // Theme sends this as text/plain (same reason the old Apps Script
    // version did — dodges flaky CORS-preflight handling for
    // application/json in some setups); parse as JSON regardless of the
    // declared content type.
    const text = await request.text();
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await handleAstroAdviceSubmission(admin, data);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.astro-advice] unhandled error:", err);
    return Response.json(
      { error: "Something went wrong saving your details. Please try again." },
      { status: 500 }
    );
  }
};
