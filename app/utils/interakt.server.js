/**
 * WhatsApp sending via Interakt's Send Template Message API — called
 * directly from our own backend (astroAdvice.server.js), on our own
 * timing, with our own per-customer content. Bypasses Interakt's
 * campaign-builder/audience-trigger system entirely, same relationship
 * Nodemailer+Gmail has to the email side: Interakt is just the delivery
 * pipe, this app decides who/when/what.
 *
 * WhatsApp Business Platform rule (Meta-wide, not Interakt-specific):
 * a business can only *initiate* a conversation using a pre-approved
 * template — no fully-freeform text. So "custom message" here means
 * "our own template, filled with our own per-customer variables",
 * not raw arbitrary text. See buildGemRecommendationTemplatePayload's
 * doc comment for the exact template to create in Interakt's UI.
 *
 * Docs referenced:
 *  https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/
 */
import { DEFAULT_INTERAKT_TEMPLATE_NAME } from "./appSettings.server";

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";

// Duplicated (not imported) from astroAdvice.server.js's FALLBACK_LOGO_URL
// deliberately — that module imports sendGemRecommendationWhatsApp from
// this one, so this file stays a leaf with no import back to it, avoiding
// a circular dependency. Used as the header image whenever a caller
// doesn't pass its own headerImageUrl.
const FALLBACK_HEADER_IMAGE_URL = "https://onlynaturalgemstones.com/cdn/shop/files/ONG_logo_home.png";

/**
 * Splits a phone number into Interakt's separate countryCode/phoneNumber
 * fields. This store's customers are assumed India-based (+91) by
 * default, same assumption normalizePhoneForShopify makes elsewhere in
 * this file's sibling module — good enough for now, revisit if the
 * store ever ships internationally.
 *
 * Returns null (meaning: skip the WhatsApp send) if the number is too
 * short/malformed to confidently split rather than guess wrong.
 */
export function splitPhoneForInterakt(phone) {
  if (!phone) return null;
  let raw = String(phone).replace(/[^\d+]/g, "");
  if (raw.charAt(0) === "+") raw = raw.slice(1);
  else if (raw.length === 11 && raw.charAt(0) === "0") raw = raw.slice(1);

  if (raw.length === 12 && raw.indexOf("91") === 0) {
    return { countryCode: "+91", phoneNumber: raw.slice(2) };
  }
  if (raw.length === 10) {
    return { countryCode: "+91", phoneNumber: raw };
  }
  if (raw.length > 10) {
    // Best-effort for a non-India number: everything but the last 10
    // digits is treated as the country code.
    return { countryCode: "+" + raw.slice(0, raw.length - 10), phoneNumber: raw.slice(-10) };
  }
  return null;
}

/**
 * Raw call to Interakt's Send Template API. Never throws — callers
 * (this file's higher-level senders, and eventually wishlist's) always
 * want a status string back to save on the lead row, same pattern as
 * sendGemRecommendationEmail/sendWishlistEmail.
 */
async function sendInteraktTemplateMessage(apiKey, payload) {
  if (!apiKey) return { ok: false, status: "skipped: Interakt API key not set (Settings page or INTERAKT_API_KEY env var)" };

  try {
    const res = await fetch(INTERAKT_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      // Without this, a hung/slow third-party response has no ceiling —
      // this call now runs in a fire-and-forget background task (see
      // astroAdvice.server.js), not blocking the customer's own request,
      // but an unbounded hang would still leave it running forever.
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!res.ok || body?.result === false) {
      return { ok: false, status: `FAILED: HTTP ${res.status} — ${JSON.stringify(body).slice(0, 300)}` };
    }
    return { ok: true, status: "OK: queued (id: " + (body?.id || "?") + ")", id: body?.id };
  } catch (err) {
    return { ok: false, status: "threw: " + String((err && err.message) || err) };
  }
}

const GEM_FALLBACK_TEXT = "Ask our expert";

/**
 * Builds the Send Template API payload for the gem-recommendation
 * WhatsApp message. Rewritten to match the leaner Utility-category
 * template actually in use now — plain text, no links, no button, just
 * the requested information (per-user request: less "marketing," more
 * "here's what you asked for").
 *
 * ---- TEMPLATE (as configured in Interakt) ----
 *
 * Name: must match AppSettings.interaktTemplateName / INTERAKT_GEM_TEMPLATE_NAME
 *       env var / DEFAULT_INTERAKT_TEMPLATE_NAME, whichever is set.
 * Language: English
 *
 * Header: Image — headerValues[0] carries the actual media URL on every
 *   send (always the store logo — see FALLBACK_HEADER_IMAGE_URL/callers).
 *
 * Body:
 *   Hello {{1}},
 *
 *   Thank you for your request on {{2}} at Only Natural Gemstones for a
 *   Gemstone Recommendation.
 *
 *   Based on your Birth-Chart (Kundli), your results are as follows:
 *   Life Stone: {{3}}
 *   Benefic Stone: {{4}}
 *   Lucky Stone: {{5}}
 *
 *   For further support, reply to this message.
 *
 *   Regards,
 *   Only Natural Gemstones
 *   from the House of Shubh Gems
 *
 * No footer, no buttons.
 *
 * ---- Variable mapping ----
 *  {{1}} first name
 *  {{2}} the date this lead's request was submitted (not "today" at send
 *        time — computed once, at submission, from the lead's own
 *        createdAt, so a later resend still shows the original date)
 *  {{3}} life stone gem name
 *  {{4}} benefic stone gem name
 *  {{5}} lucky stone gem name
 */
export function buildGemRecommendationTemplatePayload({ countryCode, phoneNumber, templateName, firstName, submittedOn, life, benefic, lucky, headerImageUrl, trackingId }) {
  const gemName = (stone) => (stone && stone.gem) || GEM_FALLBACK_TEXT;

  return {
    countryCode,
    phoneNumber,
    type: "Template",
    // Optional correlation metadata for Interakt's webhooks (delivery/read
    // status) — not used for anything today (no webhook handler wired up
    // yet), kept for when that gets built.
    callbackData: "astro-" + trackingId,
    template: {
      name: templateName || DEFAULT_INTERAKT_TEMPLATE_NAME,
      languageCode: "en",
      // Required since the approved template's header is Image type —
      // Interakt rejects the whole send with "Media Url is missing for
      // header's image" without this.
      headerValues: [headerImageUrl || FALLBACK_HEADER_IMAGE_URL],
      bodyValues: [
        firstName || "there",
        submittedOn,
        gemName(life),
        gemName(benefic),
        gemName(lucky),
      ],
    },
  };
}

/**
 * High-level entry point — mirrors sendGemRecommendationEmail's shape
 * (same "OK: ..."/"skipped: ..."/"FAILED: ..." status string), called
 * right alongside it from handleAstroAdviceSubmission and
 * resendAstroLeadEmail. Never throws.
 *
 * submittedOn: a pre-formatted display string (e.g. "14 Aug 2026") for
 * the template's {{2}} — computed by the caller (sendWhatsAppForLead in
 * astroAdvice.server.js) from the lead's own createdAt, so a later resend
 * still shows the ORIGINAL request date, not whatever day the resend
 * happens to run.
 */
export async function sendGemRecommendationWhatsApp(settings, data, recommendation, trackingId, submittedOn, headerImageUrl) {
  if (!settings.interaktApiKey) {
    return "skipped: Interakt API key not set (Settings page or INTERAKT_API_KEY env var)";
  }
  const split = splitPhoneForInterakt(data.phone);
  if (!split) {
    return "skipped: no usable phone number on this lead";
  }
  const life = (recommendation && recommendation.life) || {};
  const benefic = (recommendation && recommendation.benefic) || {};
  const lucky = (recommendation && recommendation.lucky) || {};
  const firstName = (data.name || "").split(" ")[0] || "there";

  const payload = buildGemRecommendationTemplatePayload({
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    templateName: settings.interaktTemplateName,
    firstName,
    submittedOn,
    life,
    benefic,
    lucky,
    trackingId,
    headerImageUrl,
  });

  const result = await sendInteraktTemplateMessage(settings.interaktApiKey, payload);
  return result.status;
}
