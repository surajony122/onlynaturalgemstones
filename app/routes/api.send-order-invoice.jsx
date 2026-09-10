/**
 * Backend for the "Send Invoice" admin action extension
 * (extensions/order-invoice-action) — the order page's own button calls
 * this with an explicit `Authorization: Bearer <shopify.auth.idToken()>`
 * header (see that file's own comment for why -- two earlier guesses at
 * this, an "auto-authenticated relative fetch" and a couple of wrong
 * token-method names, all failed live before landing on this one, which
 * matches the target-specific Action Extension API reference).
 *
 * Because that's a genuine cross-origin request (extension runs on
 * *.shopifycdn.com) with a custom Authorization header, the browser
 * sends a real CORS preflight OPTIONS request FIRST, carrying no
 * Authorization header at all -- authenticate.admin(request) must never
 * run on that preflight (it has nothing to authenticate and would only
 * get in the way), so OPTIONS is short-circuited before it's called.
 * The real POST goes through authenticate.admin as normal, wrapping
 * every response in its own `cors` helper (confirmed this SDK version
 * has one, same family as the public.customerAccount/appProxy variants)
 * so the extension can actually read the response.
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendOrderInvoiceEmail } from "../utils/orderInvoice.server";

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function toOrderGid(id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
  }

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
