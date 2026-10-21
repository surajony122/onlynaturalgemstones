/**
 * Daily design-image check: same free-tier pattern as cron.health-check.jsx
 * (hit this URL once a day from an external scheduler such as cron-job.org).
 * If any picture the design chooser uses is not loading, emails a plain
 * summary through the same alert email the other health checks use.
 *
 *   GET /cron/design-images?secret=<CRON_SECRET>
 */
import shopify from "../shopify.server";
import db from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendHealthAlertEmail } from "../utils/healthAlertEmail.server";
import { getDesignImageReport, designImageAlertCheck } from "../utils/designImages.server";

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
    const report = await getDesignImageReport(admin);
    if (!report.ok) {
      return Response.json({ ok: false, error: report.error });
    }

    let emailResult = { sent: false, reason: "All design images are loading" };
    if (report.broken > 0) {
      const settings = await getAppSettings(session.shop);
      emailResult = await sendHealthAlertEmail(settings, session.shop, [designImageAlertCheck(report)]);
    }

    console.log(`[cron.design-images] ${session.shop}: ${report.broken} of ${report.total} not loading, email:`, emailResult);
    return Response.json({
      ok: true,
      shop: session.shop,
      theme: report.themeName,
      total: report.total,
      broken: report.rows.filter((r) => !r.ok).map((r) => ({ name: r.name, detail: r.detail, backedUp: r.backedUp })),
      email: emailResult,
    });
  } catch (err) {
    console.error("[cron.design-images] failed:", err);
    return Response.json({ error: "Design image check failed" }, { status: 500 });
  }
};
