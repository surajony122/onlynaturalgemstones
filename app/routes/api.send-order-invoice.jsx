/**
 * Backend for the "Send Invoice" admin action extension
 * (extensions/order-invoice-action) — the order page's own button calls
 * this directly (cross-origin, from the Shopify admin domain to this
 * app's Render domain), authenticated the same way the extension calls
 * any embedded-app backend endpoint: a Shopify session token in the
 * Authorization header, verified here via authenticate.admin(request)
 * (token exchange — same mechanism the embedded app's own pages use,
 * just carried explicitly instead of via the iframe's session).
 *
 * There's no built-in CORS helper for this auth path (unlike
 * authenticate.public.customerAccount/appProxy, which each return one) —
 * headers are added manually below.
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail } from "../utils/orderInvoice.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function toOrderGid(id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

export const loader = async () => {
  // CORS preflight.
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const { admin, session } = await authenticate.admin(request);

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
    }

    const orderGid = toOrderGid(body?.orderId);
    if (!orderGid) {
      return Response.json({ ok: false, error: "orderId is required" }, { status: 400, headers: CORS_HEADERS });
    }

    const settings = await getAppSettings(session.shop);
    const result = await sendOrderInvoiceEmail(admin, settings, session.shop, orderGid);

    const ok = result.startsWith("OK:");
    return Response.json({ ok, message: result }, { status: ok ? 200 : 422, headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.send-order-invoice] failed:", err);
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500, headers: CORS_HEADERS });
  }
};
