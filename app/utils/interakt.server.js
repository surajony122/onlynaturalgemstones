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
 * Every send is tagged with an Interakt "API Campaign" id (see
 * getOrCreateInteraktCampaignId) so sent/delivered/read stats show up
 * grouped in Interakt's own dashboard under Notifications -> API
 * Campaigns, instead of only being visible one contact/conversation at a
 * time — that's the one piece of real analytics Interakt exposes for
 * API-sent messages that we can't replicate ourselves (no delivered/read
 * webhook wired up yet).
 *
 * Docs referenced:
 *  https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/
 *  https://www.interakt.shop/resource-center/api-campaign-on-whatsapp/
 */
import { DEFAULT_INTERAKT_TEMPLATE_NAME, DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME, setInteraktCampaign } from "./appSettings.server";

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";
const INTERAKT_CREATE_CAMPAIGN_URL = "https://api.interakt.ai/v1/public/create-campaign/";

// Duplicated (not imported) from astroAdvice.server.js's FALLBACK_LOGO_URL
// deliberately — that module imports sendGemRecommendationWhatsApp from
// this one, so this file stays a leaf with no import back to it, avoiding
// a circular dependency. Used as the header image whenever a caller
// doesn't pass its own headerImageUrl.
const FALLBACK_HEADER_IMAGE_URL = "https://onlynaturalgemstones.com/cdn/shop/files/ONG_logo_home.png";

// Also duplicated (not imported, same circular-dependency reason as
// above) from astroAdvice.server.js's GEM_TAGLINE — plain-text version
// here (no "&amp;" HTML entity) since this fills a WhatsApp template
// variable, not HTML email markup. Keep in sync by hand if either ever
// changes. Used for the current approved gem_recommendation template's
// {{3}}/{{5}}/{{7}} description lines (see buildGemRecommendationTemplatePayload).
const GEM_TAGLINE = {
  Ruby: "for Leadership, Vitality & Success",
  Pearl: "for Peace, Emotional Balance & Calm",
  "Red Coral": "for Courage, Strength & Vitality",
  Emerald: "for Health, Success & Growth",
  "Yellow Sapphire": "for Wealth, Wisdom & Prosperity",
  Diamond: "for Luxury, Love & Elegance",
  "Blue Sapphire": "for Good Fortune, Wealth & Success",
  Hessonite: "for Protection & Stability",
  "Cat's Eye": "for Protection & Spiritual Insight",
  Opal: "for Marital Bliss, Luxury & Pleasure",
};

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
      return { ok: false, status: `FAILED: HTTP ${res.status} — ${JSON.stringify(body).slice(0, 300)}`, rawResponse: text.slice(0, 1000) };
    }
    // rawResponse kept alongside the short status — Interakt's HTTP 200 +
    // result:true only means "we accepted your request", not "WhatsApp
    // delivered it" (that's what the separate delivery webhook is for).
    // Surfacing the FULL body (not just id) here so debug callers can see
    // everything Interakt actually returned — e.g. a message/campaign_id/
    // conversation_id field that might reveal it landed somewhere
    // unexpected (wrong campaign, wrong channel, etc.) when a send
    // reports success here but never shows up in Interakt's own UI.
    return { ok: true, status: "OK: queued (id: " + (body?.id || "?") + ")", id: body?.id, rawResponse: text.slice(0, 1000) };
  } catch (err) {
    return { ok: false, status: "threw: " + String((err && err.message) || err) };
  }
}

/**
 * Creates a new Interakt "API Campaign" — required (per Interakt's docs)
 * to be created via this API call, not from their dashboard UI. Requires
 * a Growth or Advanced Interakt plan; on a lower plan this call fails and
 * getOrCreateInteraktCampaignId below just proceeds without a campaignID
 * (sends still work, they just won't group under Notifications -> API
 * Campaigns in Interakt's dashboard).
 */
async function createInteraktCampaign(apiKey, templateName) {
  try {
    const res = await fetch(INTERAKT_CREATE_CAMPAIGN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        campaign_name: "gem-recommendation-" + templateName,
        campaign_type: "PublicAPI",
        template_name: templateName,
        language_code: "en",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!res.ok || !body?.result || !body?.data?.campaign_id) {
      return { ok: false, error: `HTTP ${res.status} — ${JSON.stringify(body).slice(0, 300)}` };
    }
    return { ok: true, campaignId: body.data.campaign_id };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * Returns a usable Interakt API Campaign id for the currently-configured
 * template, creating one (and persisting it to AppSettings) the first
 * time this ever runs, or again whenever the template name has changed
 * since the stored campaign was created (e.g. switching from the
 * Marketing template to a Utility one — a campaign is tied to one
 * template, so a renamed/replaced template needs its own fresh campaign
 * rather than silently tagging sends under a stale one). Best-effort: a
 * creation failure (wrong plan tier, API hiccup) just means this send
 * goes out without a campaignID — it still sends fine, it just won't be
 * grouped in Interakt's dashboard.
 */
export async function getOrCreateInteraktCampaignId(shop, settings) {
  const templateName = settings.interaktTemplateName || DEFAULT_INTERAKT_TEMPLATE_NAME;
  if (settings.interaktCampaignId && settings.interaktCampaignTemplateName === templateName) {
    return { campaignId: settings.interaktCampaignId, status: "OK: reused existing campaign" };
  }
  const result = await createInteraktCampaign(settings.interaktApiKey, templateName);
  if (!result.ok) {
    console.error("[interakt] failed to create API campaign:", result.error);
    return { campaignId: null, status: "FAILED: " + result.error };
  }
  try {
    await setInteraktCampaign(shop, result.campaignId, templateName);
  } catch (err) {
    console.error("[interakt] failed to persist campaign id:", err);
    return { campaignId: result.campaignId, status: "OK: created (id: " + result.campaignId + ") but FAILED to save it — will recreate a new one next send: " + String((err && err.message) || err) };
  }
  return { campaignId: result.campaignId, status: "OK: created new campaign (id: " + result.campaignId + ")" };
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
 * Body (current live/approved version — confirmed against a real HTTP 400
 * "expected number of values are 7" error, then matched exactly to what
 * the user pasted back from Interakt's own template details page; this
 * REPLACES an earlier, never-actually-approved 5-variable/no-descriptions
 * design this comment used to describe):
 *   Hello {{1}},
 *
 *   Thank you for your request at Only Natural Gemstones for Gemstone
 *   Recommendation!
 *
 *   💎 Based on your Birth-Chart (Kundli), our Vedic astrology experts
 *   recommend:
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
 *   If you have any questions about your results, feel free to reach out
 *   to astro-vedic experts.
 *
 *   Regards,
 *   Only Natural Gemstones
 *   from the House of Shubh Gems
 *
 * No footer, no buttons. No submission-date variable in this version —
 * the `submittedOn` parameter below is accepted for call-site
 * compatibility (astroAdvice.server.js still computes and passes it,
 * used elsewhere) but is NOT part of this template's body values.
 *
 * ---- Variable mapping ----
 *  {{1}} first name
 *  {{2}} life stone gem name
 *  {{3}} life stone's short benefit tagline (GEM_TAGLINE lookup)
 *  {{4}} benefic stone gem name
 *  {{5}} benefic stone's short benefit tagline
 *  {{6}} lucky stone gem name
 *  {{7}} lucky stone's short benefit tagline
 */
export function buildGemRecommendationTemplatePayload({ countryCode, phoneNumber, templateName, firstName, submittedOn, life, benefic, lucky, headerImageUrl, trackingId, campaignId }) {
  const gemName = (stone) => (stone && stone.gem) || GEM_FALLBACK_TEXT;
  const tagline = (stone) => GEM_TAGLINE[gemName(stone)] || "";

  return {
    countryCode,
    phoneNumber,
    type: "Template",
    // Optional correlation metadata for Interakt's webhooks (delivery/read
    // status) — not used for anything today (no webhook handler wired up
    // yet), kept for when that gets built.
    callbackData: "astro-" + trackingId,
    // Groups this send under an API Campaign in Interakt's own dashboard
    // (Notifications -> API Campaigns) — real sent/delivered/read stats,
    // not something we could otherwise show. Omitted (not sent as null)
    // when campaign creation failed/isn't available on this Interakt
    // plan — the send still works fine without it either way.
    ...(campaignId ? { campaignID: campaignId } : {}),
    template: {
      name: templateName || DEFAULT_INTERAKT_TEMPLATE_NAME,
      languageCode: "en",
      // Required since the approved template's header is Image type —
      // Interakt rejects the whole send with "Media Url is missing for
      // header's image" without this.
      headerValues: [headerImageUrl || FALLBACK_HEADER_IMAGE_URL],
      bodyValues: [
        firstName || "there",
        gemName(life),
        tagline(life),
        gemName(benefic),
        tagline(benefic),
        gemName(lucky),
        tagline(lucky),
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
 * submittedOn: accepted for call-site compatibility with
 * sendWhatsAppForLead (astroAdvice.server.js), which still computes it
 * from the lead's own createdAt for other uses — NOT used in this
 * template's body values (see buildGemRecommendationTemplatePayload's
 * doc comment for why: the currently-approved template has no date
 * placeholder).
 *
 * shop: needed only to persist a newly-created Interakt API Campaign id
 * (see getOrCreateInteraktCampaignId) — every other lookup here already
 * works off the resolved `settings` object.
 */
export async function sendGemRecommendationWhatsApp(settings, data, recommendation, trackingId, submittedOn, headerImageUrl, shop) {
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
  const campaignId = shop ? (await getOrCreateInteraktCampaignId(shop, settings)).campaignId : null;

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
    campaignId,
  });

  const result = await sendInteraktTemplateMessage(settings.interaktApiKey, payload);
  // Raw body appended (not just the short "OK: queued (id: ...)" status)
  // so a lead row / debug response shows EXACTLY what Interakt returned —
  // useful when Interakt reports success here but the message never
  // shows up in Interakt's own Conversations/Campaign UI, since that
  // gap can only be explained by something in the fields we normally
  // don't surface (e.g. which channel/number/campaign it actually
  // attached to).
  return result.status + (result.rawResponse ? " | raw: " + result.rawResponse : "");
}

/**
 * Sends the "order processing" WhatsApp notification — a second,
 * separate template from the gem-recommendation one (see
 * webhooks.orders.updated.jsx for when this fires).
 *
 * ---- TEMPLATE (as configured in Interakt) ----
 * Name: must match AppSettings.interaktOrderTemplateName /
 *       INTERAKT_ORDER_TEMPLATE_NAME env var / DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME.
 * Language: English
 *
 * Header: Image — same requirement hit with the gem-recommendation
 *   template (confirmed again here via a live "Media Url is missing for
 *   header's image" HTTP 400 the first time this was tested): whatever
 *   header type the template was actually created with in Interakt,
 *   every send must supply headerValues[0] to match. Uses the store logo,
 *   same as the gem-recommendation send.
 *
 * Body:
 *   Hello {{1}},
 *
 *   Your Order No. #{{2}} has been confirmed and is now being prepared
 *   with care by our team.
 *
 *   Your order is in safe hands and being prepared with the utmost care.
 *   We'll notify you as soon as your order is shipped.
 *
 *   Regards,
 *   Only Natural Gemstones
 *   from the House of Shubh Gems
 *
 * No footer, no buttons.
 *
 * ---- Variable mapping ----
 *  {{1}} customer first name
 *  {{2}} order number (Shopify's own order.name, minus the leading "#" —
 *        the template text already supplies "#" before {{2}})
 */
export async function sendOrderProcessingWhatsApp(settings, { phone, firstName, orderNumber, shop, headerImageUrl }) {
  if (!settings.interaktApiKey) {
    return "skipped: Interakt API key not set (Settings page or INTERAKT_API_KEY env var)";
  }
  const split = splitPhoneForInterakt(phone);
  if (!split) {
    return "skipped: no usable phone number on this order";
  }

  const templateName = settings.interaktOrderTemplateName || DEFAULT_INTERAKT_ORDER_TEMPLATE_NAME;
  const payload = {
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    type: "Template",
    callbackData: "order-" + orderNumber,
    template: {
      name: templateName,
      languageCode: "en",
      headerValues: [headerImageUrl || FALLBACK_HEADER_IMAGE_URL],
      bodyValues: [firstName || "there", String(orderNumber || "").replace(/^#/, "")],
    },
  };

  const result = await sendInteraktTemplateMessage(settings.interaktApiKey, payload);
  return result.status;
}
