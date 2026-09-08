/**
 * One-off, read-only diagnostic dump for the order-processing WhatsApp +
 * email feature -- lets Claude self-check current status (Gmail SMTP
 * health, recent webhook receipts, recent notification outcomes)
 * without needing the user to screenshot the Server page. NOT a
 * permanent standing endpoint -- delete this file once the check it was
 * created for is done.
 *
 * NOTE: do not import shopify.server (or anything else) here unless it's
 * actually used inside the loader body -- an unused server-only import
 * at module scope broke the production build once already (React
 * Router's client/server code-splitting flags it as something the
 * client bundle might need, since it can't prove an unused import has
 * no side effects).
 *
 *   GET /admin/diagnose-order-processing?secret=<DIAG_SECRET>&orderId=<numeric order id, optional>
 */
import db from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { checkGmail } from "../utils/serviceHealth.server";

const DIAG_SECRET = "3b9f7e1a2c4d6058b7e9f1a3c5d7e9f0b1a2c3d4e5f60718";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== DIAG_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orderId = url.searchParams.get("orderId");

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ error: "No shop installed" }, { status: 500 });
  }

  const settings = await getAppSettings(session.shop);
  const gmail = await checkGmail(settings).catch((err) => ({ ok: false, detail: "threw: " + String(err) }));

  const receiptWhere = orderId ? { orderId: String(orderId) } : {};
  const [webhookReceipts, waNotifications, emailNotifications] = await Promise.all([
    db.webhookReceiptLog.findMany({ where: receiptWhere, orderBy: { receivedAt: "desc" }, take: orderId ? 20 : 10 }),
    db.orderProcessingNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: 10 }),
    db.orderProcessingEmailNotification.findMany({ orderBy: { notifiedAt: "desc" }, take: 10 }),
  ]);

  return Response.json({
    gmail,
    orderIdFilter: orderId || null,
    webhookReceipts,
    waNotifications,
    emailNotifications,
  });
};
