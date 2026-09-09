/**
 * TEMPORARY diagnostic route — checks whether order-processing email +
 * WhatsApp are actually working right now, without needing to log into
 * the embedded Shopify admin app. Reuses the exact same check functions
 * the Server/Settings pages use (checkGmail/checkInterakt), plus the
 * real send-history tables and webhook receipt log, so this is a
 * faithful live snapshot, not a guess. Delete after use — same
 * throwaway pattern as this project's other admin.diagnose-*.jsx routes.
 *
 *   GET /cron/diagnose-order-processing?secret=<CRON_SECRET>
 */
import db from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { checkGmail, checkInterakt } from "../utils/serviceHealth.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!expected) return Response.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 });
  if (secret !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return Response.json({ ok: true, note: "No shop installed yet — nothing to check." });

  const settings = await getAppSettings(session.shop);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [gmail, interakt, recentWhatsapp, recentEmail, recentReceipts] = await Promise.all([
    checkGmail(settings),
    checkInterakt(settings),
    db.orderProcessingNotification.findMany({ where: { notifiedAt: { gte: since } }, orderBy: { notifiedAt: "desc" }, take: 15 }),
    db.orderProcessingEmailNotification.findMany({ where: { notifiedAt: { gte: since } }, orderBy: { notifiedAt: "desc" }, take: 15 }),
    db.webhookReceiptLog.findMany({ orderBy: { receivedAt: "desc" }, take: 10 }),
  ]);

  return Response.json({
    ok: true,
    shop: session.shop,
    liveServiceChecks: { gmail, interakt },
    orderProcessingTriggerTag: settings.orderProcessingTriggerTag,
    recentWhatsappNotifications: recentWhatsapp.map((n) => ({ ...n, notifiedAt: n.notifiedAt.toISOString() })),
    recentEmailNotifications: recentEmail.map((n) => ({ ...n, notifiedAt: n.notifiedAt.toISOString() })),
    recentWebhookReceipts: recentReceipts.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })),
  });
};
