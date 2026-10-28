/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/gem-advice-otp-verify
 *
 * Step 2 of the Gem Recommendation ("Astro Advice") form's OTP
 * verification, AND the final submission in one call — the server only
 * ever accepts the astrology data once the code is confirmed server-
 * side, so this replaces the theme's old second call to
 * proxy.astro-advice.jsx directly.
 *
 * Request body (JSON): the full form payload PLUS { otpCode } and
 * (already computed client-side, unchanged) astroBirthDetails /
 * astroGemSuggestion / astroChartSvg / astroError.
 *
 * Response (JSON):
 *   - A wrong/expired/too-many-attempts code returns { ok: false, error }
 *     unchanged (not a system failure — let the customer retry/resend).
 *   - On a correct code, returns EXACTLY what handleAstroAdviceSubmission
 *     already returns today (the normal success/astroFailed shape) —
 *     this route changes nothing about that path.
 *   - Only a genuine thrown/unexpected error here falls back to saving
 *     the lead and returning { ok: true, fallback: true, message }.
 */
import { authenticate } from "../shopify.server";
import { verifyGemAdviceOtpCode } from "../utils/gemAdviceOtp.server";
import { handleAstroAdviceSubmission } from "../utils/astroAdvice.server";
import { validateGemAdviceInput } from "../utils/gemAdviceValidation";
import { getAppSettings } from "../utils/appSettings.server";
import { fetchAstrologyForSubmission } from "../utils/astrologyApi.server";

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

  // Checked before the code is used up, so a rejected submission never burns the customer's code.
  const check = validateGemAdviceInput(data);
  if (!check.ok) return Response.json({ ok: false, error: check.error });

  try {
    const verifyResult = await verifyGemAdviceOtpCode(session.shop, data.phone, data.email, data.otpCode);
    if (!verifyResult.ok) {
      // Wrong code / expired / too many attempts -- a normal outcome of
      // the verification system doing its job, not a failure to fall
      // back on. Let the customer correct the code or resend.
      return Response.json(verifyResult);
    }

    // Code verified. The chart is now calculated HERE, on the server, with the AstrologyAPI login saved in Settings -- so the login is
    // never in the page, AstrologyAPI is only called for visitors who passed the one-time code, and the browser cannot send in a
    // chart of its own. If no login is saved yet, carry on exactly as before with whatever the browser sent.
    const settings = await getAppSettings(session.shop);
    const astro = await fetchAstrologyForSubmission(settings, data);
    let submission = data;
    if (!astro.skipped) {
      const { astroBirthDetails, astroGemSuggestion, astroChartSvg, astroError, ...rest } = data;
      submission = astro.ok
        ? { ...rest, astroBirthDetails: astro.astroBirthDetails, astroGemSuggestion: astro.astroGemSuggestion, astroChartSvg: astro.astroChartSvg }
        : { ...rest, astroError: astro.error };
    }
    const result = await handleAstroAdviceSubmission(admin, session.shop, submission);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.gem-advice-otp-verify] unhandled error, falling back:", err);
    try {
      await handleAstroAdviceSubmission(admin, session.shop, { ...data, astroError: "OTP verification failed: " + err });
    } catch (saveErr) {
      console.error("[proxy.gem-advice-otp-verify] fallback lead save also failed:", saveErr);
    }
    return Response.json({
      ok: true,
      fallback: true,
      message: "We've saved your details — our team will get back to you shortly.",
    });
  }
};
