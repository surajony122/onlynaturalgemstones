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

// Duplicated (not imported) from astroAdvice.server.js deliberately — that
// module will import sendGemRecommendationWhatsApp from this one, so this
// file stays a leaf with no import back to it, avoiding a circular
// dependency. track.$type.jsx already duplicates this same constant for
// the same reason.
const STORE_DOMAIN = "onlynaturalgemstones.com";

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
 * WhatsApp message.
 *
 * ---- TEMPLATE TO CREATE IN INTERAKT (Catalog & Templates → Templates
 * Library → Create Template), category Marketing, before any send here
 * will work — Meta must approve it first, usually a few hours:
 *
 * Name: gem_recommendation   (must match AppSettings.interaktTemplateName,
 *                              or INTERAKT_GEM_TEMPLATE_NAME env var, or
 *                              this default if both are left blank)
 * Language: English
 *
 * Header: Text, no variable —  "✨ Your Personalised Gemstone Recommendation"
 *
 * Body:
 *   Hi {{1}}! 💎
 *
 *   Based on your birth chart, our Vedic astrology experts recommend:
 *
 *   🔶 Life Stone: {{2}}
 *   {{3}}
 *
 *   🍀 Benefic Stone: {{4}}
 *   {{5}}
 *
 *   🔷 Lucky Stone: {{6}}
 *   {{7}}
 *
 *   Tap below to view your full personalised reading.
 *
 * Footer (static, no variable): Only Natural Gemstones
 *
 * Buttons: one dynamic "Visit Website" button —
 *   Button text: View Full Recommendation
 *   Base URL:    https://shubh-gems-customizer-app.onrender.com/track/click?id=
 *   (mark the URL as dynamic — Interakt/Meta append the value we send in
 *   buttonPayload["0"][0] directly after this base URL, no {{1}} needed
 *   inside the URL itself, just the trailing dynamic-value toggle)
 *
 * ---- Variable mapping ----
 *  {{1}} first name
 *  {{2}} life stone gem name        {{3}} life stone collection link
 *  {{4}} benefic stone gem name     {{5}} benefic stone collection link
 *  {{6}} lucky stone gem name       {{7}} lucky stone collection link
 */
export function buildGemRecommendationTemplatePayload({ countryCode, phoneNumber, templateName, firstName, life, benefic, lucky, trackingId, resultsUrl }) {
  const stoneLine = (stone) => {
    if (!stone || !stone.gem) return { name: GEM_FALLBACK_TEXT, url: "https://" + STORE_DOMAIN };
    const url = stone.collection ? "https://" + STORE_DOMAIN + "/collections/" + stone.collection : "https://" + STORE_DOMAIN;
    return { name: stone.gem, url };
  };

  const lifeLine = stoneLine(life);
  const beneficLine = stoneLine(benefic);
  const luckyLine = stoneLine(lucky);

  // The button's base URL (configured in Interakt, see doc comment above)
  // is our own /track/click route up to "?id=" — everything after that
  // is this dynamic suffix, so the click still logs a real "clicked"
  // EmailEvent and 302s to the results page, same as the email's button.
  // resultsUrl is passed in by the caller (astroAdvice.server.js), which
  // already builds the exact same link for the email — kept as one
  // source of truth rather than reconstructed here.
  const buttonSuffix =
    encodeURIComponent(trackingId) +
    "&url=" + encodeURIComponent(resultsUrl) +
    "&label=" + encodeURIComponent("whatsapp_view_full_recommendation");

  return {
    countryCode,
    phoneNumber,
    type: "Template",
    callbackData: "astro-" + trackingId,
    template: {
      name: templateName || DEFAULT_INTERAKT_TEMPLATE_NAME,
      languageCode: "en",
      bodyValues: [
        firstName || "there",
        lifeLine.name,
        lifeLine.url,
        beneficLine.name,
        beneficLine.url,
        luckyLine.name,
        luckyLine.url,
      ],
      buttonPayload: { "0": [buttonSuffix] },
    },
  };
}

/**
 * High-level entry point — mirrors sendGemRecommendationEmail's shape
 * (same "OK: ..."/"skipped: ..."/"FAILED: ..." status string), called
 * right alongside it from handleAstroAdviceSubmission and
 * resendAstroLeadEmail. Never throws.
 */
export async function sendGemRecommendationWhatsApp(settings, data, recommendation, trackingId, resultsUrl) {
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
    life,
    benefic,
    lucky,
    trackingId,
    resultsUrl,
  });

  const result = await sendInteraktTemplateMessage(settings.interaktApiKey, payload);
  return result.status;
}
