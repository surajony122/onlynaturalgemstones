/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/gem-advice-otp-request
 *
 * Step 1 of the Gem Recommendation ("Astro Advice") form's OTP
 * verification — replaces the old flow where the code was generated in
 * the browser and "sending" it silently did nothing real (the request
 * went to proxy.astro-advice.jsx, which has no handling for it at all).
 *
 * Request body (JSON): the full form payload the theme already builds
 * (name, email, phone, dob, tob, placeOfBirth, lat, lon, tzone, gender,
 * purpose, bodyWeightKg, ...).
 * Response (JSON):
 *   { ok: true }                           — code sent via WhatsApp and/or Email
 *   { ok: false, error }                   — normal validation/rate-limit error, show inline, let the customer retry
 *   { ok: true, fallback: true, message }  — system failure (delivery totally unavailable); lead has
 *                                             already been saved to Shopify, show the "team will follow
 *                                             up" popup instead of the OTP step
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { sendGemAdviceWhatsAppOtp } from "../utils/interakt.server";
import { createGemAdviceOtpCode, sendGemAdviceOtpEmail } from "../utils/gemAdviceOtp.server";
import { handleAstroAdviceSubmission } from "../utils/astroAdvice.server";

async function saveFallbackLead(admin, shop, data, reason) {
  // Reuses the astro-advice pipeline's own existing "astroError present"
  // path (lead saved, Shopify-synced, no email/WhatsApp attempted, a
  // "team will follow up" response returned) rather than duplicating
  // that logic here — this route just supplies a different reason string.
  try {
    await handleAstroAdviceSubmission(admin, shop, { ...data, astroError: reason });
  } catch (err) {
    console.error("[proxy.gem-advice-otp-request] fallback lead save failed:", err);
  }
  return {
    ok: true,
    fallback: true,
    message: "We've saved your details — our team will get back to you shortly.",
  };
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session?.shop) {
    return Response.json({ ok: false, error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await createGemAdviceOtpCode(session.shop, data.phone, data.email);
    if (!result.ok) {
      // Validation/rate-limit error, not a system failure — surface it
      // normally so the customer can wait/correct and retry.
      return Response.json(result);
    }

    const settings = await getAppSettings(session.shop);
    const [whatsappStatus, emailStatus] = await Promise.all([
      data.phone
        ? sendGemAdviceWhatsAppOtp(settings, { phone: data.phone, code: result.code }).catch((err) => "threw: " + err)
        : Promise.resolve("skipped: no phone"),
      data.email
        ? sendGemAdviceOtpEmail(settings, { email: data.email, name: data.name, code: result.code }).catch((err) => "threw: " + err)
        : Promise.resolve("skipped: no email"),
    ]);

    const whatsappOk = whatsappStatus.startsWith("OK");
    const emailOk = emailStatus.startsWith("OK");

    if (!whatsappOk && !emailOk) {
      console.error("[proxy.gem-advice-otp-request] both delivery channels failed:", whatsappStatus, emailStatus);
      return Response.json(await saveFallbackLead(admin, session.shop, data, "OTP delivery unavailable (WhatsApp: " + whatsappStatus + " | Email: " + emailStatus + ")"));
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[proxy.gem-advice-otp-request] unhandled error:", err);
    return Response.json(await saveFallbackLead(admin, session.shop, data, "OTP request failed: " + err));
  }
};
