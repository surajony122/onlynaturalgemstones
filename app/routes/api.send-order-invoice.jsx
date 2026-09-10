/**
 * Backend for the "Send Invoice" admin action extension
 * (extensions/order-invoice-action) — the order page's own button calls
 * this directly. Admin UI extensions auto-authenticate fetch() calls
 * resolved against the app's own application_url (no manual token
 * handling needed on the extension side) — see
 * https://shopify.dev/docs/apps/build/admin/actions-blocks/connect-app-backend.
 * authenticate.admin(request) verifies that inbound authorization here,
 * the same as any embedded page load, and its own `cors` helper (NOT
 * manual headers — confirmed this SDK version provides one, same as the
 * public.customerAccount/appProxy variants) wraps every response so the
 * extension (hosted on a separate shopifycdn.com domain) can actually
 * read it.
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail } from "../utils/orderInvoice.server";

function toOrderGid(id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

export const action = async ({ request }) => {
  const { admin, session, cors } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return cors(Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }));
  }

  const orderGid = toOrderGid(body?.orderId);
  if (!orderGid) {
    return cors(Response.json({ ok: false, error: "orderId is required" }, { status: 400 }));
  }

  try {
    const settings = await getAppSettings(session.shop);
    const result = await sendOrderInvoiceEmail(admin, settings, session.shop, orderGid);
    const ok = result.startsWith("OK:");
    return cors(Response.json({ ok, message: result }, { status: ok ? 200 : 422 }));
  } catch (err) {
    console.error("[api.send-order-invoice] failed:", err);
    return cors(Response.json({ ok: false, error: String(err.message || err) }, { status: 500 }));
  }
};
