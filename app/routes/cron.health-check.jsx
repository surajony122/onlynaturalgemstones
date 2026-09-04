/**
 * Auto-detection half of the app's health checks — runs the exact same
 * diagnostics the app's own Diagnostics/Troubleshooting tabs show, but
 * on a schedule instead of only when a merchant happens to open the app.
 * When something's wrong, emails a plain-language summary (see
 * healthAlertEmail.server.js) so a non-technical merchant finds out
 * without needing to know to check the app at all.
 *
 * Same free-tier pattern as cron.cleanup.jsx: hit this URL once a day
 * from an external scheduler (cron-job.org, GitHub Actions, etc.) rather
 * than a paid Render Cron Job.
 *
 *   GET /cron/health-check?secret=<CRON_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { runFullSystemDiagnostics } from "../utils/gemstoneCustomisationMatrix.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendHealthAlertEmail } from "../utils/healthAlertEmail.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  }
  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ ok: true, note: "No shop installed yet — nothing to check." });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const checks = await runFullSystemDiagnostics(admin);
    const failing = checks.filter((c) => c.status !== "PASS");

    let emailResult = { sent: false, reason: "No issues found" };
    if (failing.length > 0) {
      const settings = await getAppSettings(session.shop);
      emailResult = await sendHealthAlertEmail(settings, session.shop, failing);
    }

    console.log(`[cron.health-check] ${session.shop}: ${failing.length} issue(s), email:`, emailResult);
    return Response.json({
      ok: true,
      shop: session.shop,
      totalChecks: checks.length,
      failingChecks: failing.map((c) => ({ name: c.name, status: c.status, plain: c.plain })),
      email: emailResult,
    });
  } catch (err) {
    console.error("[cron.health-check] failed:", err);
    return Response.json({ error: "Health check failed" }, { status: 500 });
  }
};
