/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-otp-verify
 *
 * Step 2 of the storefront's separate WhatsApp-OTP "My Account" login —
 * checks the code, issues a session token on success. The token is
 * handed back in the JSON body (not a cookie) for the theme's own JS to
 * store (localStorage) and send back as `{ token }` on later calls —
 * sidesteps any uncertainty about whether Shopify's App Proxy reliably
 * forwards Set-Cookie headers back to the browser.
 *
 * Request body (JSON): { phone, code }
 * Response (JSON): { ok: true, token } or { ok: false, error }
 */
import { authenticate } from "../shopify.server";
import { verifyOtpCode } from "../utils/whatsappOtpAuth.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) {
    return Response.json({ ok: false, error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await verifyOtpCode(session.shop, data.phone, data.code);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.whatsapp-otp-verify] unhandled error:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
};
