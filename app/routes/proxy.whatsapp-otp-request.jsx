/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-otp-request
 *
 * Step 1 of the storefront's separate WhatsApp-OTP "My Account" login
 * (see CLAUDE.md-style context in whatsappOtpAuth.server.js's doc
 * comment for why this exists instead of Shopify's native login).
 *
 * Request body (JSON): { phone }
 * Response (JSON): { ok: true } or { ok: false, error }
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendWhatsAppLoginOtp } from "../utils/interakt.server";
import { createOtpCode } from "../utils/whatsappOtpAuth.server";

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
    const result = await createOtpCode(session.shop, data.phone);
    if (!result.ok) {
      return Response.json(result);
    }

    const settings = await getAppSettings(session.shop);
    const sendStatus = await sendWhatsAppLoginOtp(settings, { phone: data.phone, code: result.code });
    if (!sendStatus.startsWith("OK")) {
      console.error("[proxy.whatsapp-otp-request] Interakt send failed:", sendStatus);
      return Response.json({ ok: false, error: "Couldn't send the code. Please try again." });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[proxy.whatsapp-otp-request] unhandled error:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
};
