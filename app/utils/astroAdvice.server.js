/**
 * Astro Advice / gem-recommendation lead pipeline — merged in from the
 * standalone astro-lead-sync-app + Google Apps Script backend (Code.gs).
 * Called from app/routes/proxy.astro-advice.jsx, which is what the
 * theme's shubh-astro-advice.js now posts to instead of an Apps Script
 * Web App URL (same request/response JSON shape as before, so the theme
 * JS itself needed zero changes — see MERGE_ASTRO_ADVICE.md).
 *
 * What changed vs. the Apps Script version, and why:
 *  - Shopify sync now uses the `admin` client this app already has
 *    (via the app proxy's own authenticated session) instead of a
 *    separate manual OAuth code-exchange dance — one less app
 *    registration to maintain.
 *  - Leads/events are written to this app's own Postgres database
 *    (source of truth) AND best-effort mirrored into the same Google
 *    Sheet as before (see googleSheets.server.js), so the existing
 *    "just open the Sheet" habit still works.
 *  - Email now sends via Nodemailer/Gmail SMTP instead of GmailApp —
 *    functionally the same (same Gmail account, same quota), just
 *    callable from Node instead of only from Apps Script.
 *  - Open/click tracking pixels/links now point at this app's own
 *    public /track route (see app/routes/track.$type.jsx) instead of
 *    an Apps Script doGet — same mechanism, same caveats (no real
 *    "delivered" signal, pixel opens are best-effort).
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { mirrorLeadToSheet, mirrorEmailEventToSheet } from "./googleSheets.server";
import { getAppSettings } from "./appSettings.server";

// The storefront's real customer-facing domain (not the *.myshopify.com
// admin domain) — used to build the results-page link embedded in the
// recommendation email. Matches STORE_DOMAIN in the old Code.gs.
const STORE_DOMAIN = "onlynaturalgemstones.com";

// Maps AstrologyAPI's basic_gem_suggestion "gem_key" values to this
// store's actual Shopify collection handles — identical to Code.gs's
// GEM_KEY_TO_COLLECTION, kept in sync by hand if it ever changes there.
const GEM_KEY_TO_COLLECTION = {
  ruby: { gem: "Ruby", collection: "ruby" },
  pearl: { gem: "Pearl", collection: "pearls" },
  red_coral: { gem: "Red Coral", collection: "red-coral" },
  emerald: { gem: "Emerald", collection: "emerald" },
  yellow_sapphire: { gem: "Yellow Sapphire", collection: "yellow-sapphire" },
  diamond: { gem: "Diamond", collection: "diamond" },
  blue_sapphire: { gem: "Blue Sapphire", collection: "blue-sapphire" },
  hessonite: { gem: "Hessonite", collection: "hessonite" },
  gomed: { gem: "Hessonite", collection: "hessonite" },
  cats_eye: { gem: "Cat's Eye", collection: "cats-eye" },
  opal: { gem: "Opal", collection: "opal" },
};

// Short benefit taglines shown under each gem name in the result email —
// AstrologyAPI doesn't supply these, so it's a fixed lookup by the gem's
// display name (matches GEM_KEY_TO_COLLECTION's "gem" values).
const GEM_TAGLINE = {
  Ruby: "for Leadership, Vitality &amp; Success",
  Pearl: "for Peace, Emotional Balance &amp; Calm",
  "Red Coral": "for Courage, Strength &amp; Vitality",
  Emerald: "for Health, Success &amp; Growth",
  "Yellow Sapphire": "for Wealth, Wisdom &amp; Prosperity",
  Diamond: "for Luxury, Love &amp; Elegance",
  "Blue Sapphire": "for Good Fortune, Wealth &amp; Success",
  Hessonite: "for Protection &amp; Stability",
  "Cat's Eye": "for Protection &amp; Spiritual Insight",
  Opal: "for Marital Bliss, Luxury &amp; Pleasure",
};

function buildGemInfo(entry) {
  if (!entry || !entry.gem_key) return null;
  const info = GEM_KEY_TO_COLLECTION[entry.gem_key] || { gem: entry.name, collection: null };
  return {
    planet: entry.gem_deity || null,
    gem: info.gem || entry.name,
    collection: info.collection,
    substitute: entry.semi_gem || null,
    weightCarat: entry.weight_caret || null,
    wearMetal: entry.wear_metal || null,
    wearFinger: entry.wear_finger || null,
    wearDay: entry.wear_day || null,
  };
}

function buildRecommendations(gemSuggestion) {
  if (!gemSuggestion) return null;
  return {
    life: buildGemInfo(gemSuggestion.LIFE),
    benefic: buildGemInfo(gemSuggestion.BENEFIC),
    lucky: buildGemInfo(gemSuggestion.LUCKY),
  };
}

/**
 * Main entry point — mirrors Code.gs's doPost almost exactly, just with
 * Prisma instead of a Sheet as primary storage and `admin` passed in
 * (already authenticated by the caller via the app proxy) instead of a
 * manually-managed OAuth token.
 */
export async function handleAstroAdviceSubmission(admin, shop, data) {
  if (!data || !data.dob || !data.tob || typeof data.lat !== "number" || typeof data.lon !== "number") {
    return { error: "dob, tob, lat, and lon are all required" };
  }

  const trackingId = crypto.randomUUID();
  const settings = await getAppSettings(shop);

  let birthDetails = null;
  let recommendation = null;
  let chartSvg = null;
  let astroError = null;

  // Same reasoning as Code.gs: AstrologyAPI's account is domain-restricted
  // to genuine browser requests, so the browser calls it directly and
  // sends the raw results here — this never calls AstrologyAPI itself.
  if (data.astroError) {
    astroError = String(data.astroError);
    console.log("[astroAdvice] client-side AstrologyAPI call failed, saving lead without a chart:", astroError);
  } else if (data.astroBirthDetails) {
    try {
      birthDetails = data.astroBirthDetails;
      recommendation = buildRecommendations(data.astroGemSuggestion) || {};
      chartSvg = data.astroChartSvg || null;
    } catch (procErr) {
      astroError = String(procErr);
      console.log("[astroAdvice] failed to process client-supplied astrology data:", astroError);
    }
  } else {
    astroError = "No astrology data provided by client";
    console.log("[astroAdvice]", astroError);
  }

  // Always save, whether or not the calculation above succeeded — a
  // failed API call is still a real lead worth following up on manually.
  const life = (recommendation && recommendation.life) || {};
  const benefic = (recommendation && recommendation.benefic) || {};
  const lucky = (recommendation && recommendation.lucky) || {};
  let lead;
  try {
    lead = await prisma.astroLead.create({
      data: {
        trackingId,
        shop: shop || null,
        name: data.name || null,
        email: data.email || null,
        phone: data.phone || null,
        gender: data.gender || null,
        purpose: data.purpose || null,
        bodyWeightKg: typeof data.bodyWeightKg === "number" ? data.bodyWeightKg : null,
        dob: data.dob || null,
        tob: data.tob || null,
        placeOfBirth: data.placeOfBirth || null,
        ascendant: (birthDetails && birthDetails.ascendant) || null,
        moonsign: (birthDetails && birthDetails.moonsign) || null,
        sunsign: (birthDetails && birthDetails.sunsign) || null,
        lifeStoneGem: life.gem || null,
        lifeStonePlanet: life.planet || null,
        beneficStoneGem: benefic.gem || null,
        luckyStoneGem: lucky.gem || null,
        recommendation: recommendation || undefined,
        calculationOk: !astroError,
        astroError: astroError || null,
      },
    });
    await mirrorLeadToSheet(settings, lead);
  } catch (dbErr) {
    console.error("[astroAdvice] failed to save lead to database:", dbErr);
  }

  // Best-effort mirror into Shopify — never allowed to affect the
  // response sent back to the customer or the fact that the lead is
  // already saved.
  let shopifySyncStatus = "not run";
  try {
    shopifySyncStatus = await syncLeadToShopify(admin, data, birthDetails || {}, recommendation || {}, astroError);
  } catch (syncErr) {
    shopifySyncStatus = "threw: " + syncErr;
    console.error("[astroAdvice] failed to sync lead to Shopify:", syncErr);
  }

  // Best-effort: email the personalised recommendation directly —
  // bypassing Shopify Email entirely. Only when the chart actually
  // resolved; astroError leads have already been saved above for manual
  // follow-up.
  let emailSendStatus = "not run";
  if (!astroError && data.email) {
    try {
      emailSendStatus = await sendGemRecommendationEmail(admin, settings, data, birthDetails || {}, recommendation || {}, trackingId);
    } catch (emailErr) {
      emailSendStatus = "threw: " + emailErr;
      console.error("[astroAdvice] failed to send recommendation email:", emailErr);
    }
  } else if (!data.email) {
    emailSendStatus = "skipped: no email on lead";
  } else {
    emailSendStatus = "skipped: astro calculation failed for this submission";
  }

  if (lead) {
    try {
      await prisma.astroLead.update({
        where: { id: lead.id },
        data: { shopifySyncStatus, emailSendStatus },
      });
    } catch (updateErr) {
      console.error("[astroAdvice] failed to backfill sync/email status on lead row:", updateErr);
    }
  }

  if (astroError) {
    const response = {
      ok: true,
      leadSaved: true,
      astroFailed: true,
      error: "We've saved your details — our team will follow up with your personalised recommendation shortly.",
    };
    if (data.debug === true) {
      response.debugError = astroError;
      response.shopifySyncStatus = shopifySyncStatus;
      response.emailSendStatus = emailSendStatus;
    }
    return response;
  }

  const successResponse = {
    ok: true,
    leadSaved: true,
    ascendant: birthDetails.ascendant,
    moonsign: birthDetails.moonsign,
    sunsign: birthDetails.sunsign,
    nakshatra: birthDetails.nakshatra || null,
    recommendation,
    chartSvg,
  };
  if (data.debug === true) {
    successResponse.shopifySyncStatus = shopifySyncStatus;
    successResponse.emailSendStatus = emailSendStatus;
  }
  return successResponse;
}

/**
 * Mirrors this lead into Shopify as a tagged, subscribed Customer record —
 * same upsert-by-email-with-tags-and-note-and-metafield trick as
 * Code.gs's syncLeadToShopify, just using the app's own already-
 * authenticated `admin` GraphQL client instead of a manually-managed
 * OAuth token from a separate app registration.
 */
async function syncLeadToShopify(admin, data, birthDetails, recommendation, astroError) {
  if (!data.email) {
    console.log("[astroAdvice] Shopify sync skipped: lead has no email");
    return "skipped: lead has no email";
  }

  const noteLine =
    "[" + new Date().toISOString() + "] Astro Advice lead — " +
    "DOB: " + (data.dob || "—") + ", TOB: " + (data.tob || "—") +
    ", Place: " + (data.placeOfBirth || "—") +
    ", Purpose: " + (data.purpose || "—") +
    (birthDetails && birthDetails.ascendant ? ", Ascendant: " + birthDetails.ascendant : "") +
    (recommendation && recommendation.life && recommendation.life.gem
      ? ", Recommended: " + recommendation.life.gem
      : "") +
    (astroError ? ", chart calculation FAILED this time (see database for the raw error)" : "");

  const phone = normalizePhoneForShopify(data.phone);

  const existing = await shopifyFindCustomerByEmail(admin, data.email);
  const updateMutation = `#graphql
    mutation($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { field message } } }`;
  const createMutation = `#graphql
    mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`;

  const alreadyUnsubscribed =
    existing && existing.emailMarketingConsent && existing.emailMarketingConsent.marketingState === "UNSUBSCRIBED";
  // Shopify rejects consentUpdatedAt if it's "in the future" relative to
  // its own clock — a plain `new Date()` here got flagged even though it
  // wasn't really in the future, just close enough to trip on ordinary
  // clock skew/latency between Render's clock and Shopify's validation.
  // Backdating by a minute gives enough slack to never trip that check
  // while still being accurate to well within any reasonable tolerance.
  const consentInput = alreadyUnsubscribed
    ? null
    : {
        marketingState: "SUBSCRIBED",
        marketingOptInLevel: "SINGLE_OPT_IN",
        consentUpdatedAt: new Date(Date.now() - 60000).toISOString(),
      };

  const metafieldData = {
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    dob: data.dob || "",
    tob: data.tob || "",
    placeOfBirth: data.placeOfBirth || "",
    purpose: data.purpose || "",
    ascendant: (birthDetails && birthDetails.ascendant) || "",
    recommendations: recommendation || {},
    timestamp: new Date().toISOString(),
  };
  const astroMetafields = [
    { namespace: "custom", key: "astro_advice", type: "json", value: JSON.stringify(metafieldData) },
  ];

  let customerId, mainStatus;

  if (existing) {
    const tags = existing.tags || [];
    if (tags.indexOf("gem-lead") === -1) tags.push("gem-lead");
    // Shopify caps Customer.note at 5000 characters and rejects the whole
    // update (not just truncates) if it's over — a repeat customer with
    // enough submissions over time would eventually hit that and start
    // silently failing the tag/note sync. Keep only the most recent
    // ~4900 chars (a little headroom under the real 5000 limit) so this
    // never happens; older history is still in the astro_advice metafield
    // (which gets fully overwritten each time, not appended) and the
    // database/Sheet, this note is just a quick-glance log.
    const rawMergedNote = existing.note ? existing.note + "\n" + noteLine : noteLine;
    const mergedNote = rawMergedNote.length > 4900 ? rawMergedNote.slice(rawMergedNote.length - 4900) : rawMergedNote;
    const updateInput = { id: existing.id, tags, note: mergedNote, metafields: astroMetafields };
    if (phone) updateInput.phone = phone;

    let updateResult = await shopifyAdminGraphQL(admin, updateMutation, { input: updateInput });
    if (phone && hasUserError(updateResult, "customerUpdate", "phone")) {
      console.log(`[astroAdvice] Shopify customer update: phone "${phone}" rejected, retrying without it`);
      delete updateInput.phone;
      updateResult = await shopifyAdminGraphQL(admin, updateMutation, { input: updateInput });
    }
    customerId = existing.id;
    mainStatus = describeGraphQLResult(updateResult, "customerUpdate", existing.id);
  } else {
    const createInput = {
      email: data.email,
      firstName: data.name || undefined,
      tags: ["gem-lead"],
      note: noteLine,
      metafields: astroMetafields,
    };
    if (phone) createInput.phone = phone;

    let createResult = await shopifyAdminGraphQL(admin, createMutation, { input: createInput });
    if (phone && hasUserError(createResult, "customerCreate", "phone")) {
      console.log(`[astroAdvice] Shopify customer create: phone "${phone}" rejected, retrying without it`);
      delete createInput.phone;
      createResult = await shopifyAdminGraphQL(admin, createMutation, { input: createInput });
    }
    customerId =
      createResult?.data?.customerCreate?.customer?.id;
    mainStatus = describeGraphQLResult(createResult, "customerCreate", data.email);
  }

  let consentStatus = "skipped (no customer id)";
  if (alreadyUnsubscribed) {
    consentStatus = "skipped: already unsubscribed";
  } else if (consentInput && customerId) {
    const consentResult = await shopifyAdminGraphQL(
      admin,
      `#graphql
      mutation($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) { userErrors { field message } }
      }`,
      { input: { customerId, emailMarketingConsent: consentInput } }
    );
    consentStatus = describeGraphQLResult(consentResult, "customerEmailMarketingConsentUpdate", customerId);
  }

  return mainStatus + " | consent: " + consentStatus;
}

function describeGraphQLResult(result, mutationName, context) {
  if (!result) return "FAILED: no response from Shopify (see logs for HTTP-level error)";
  if (result.errors) return "FAILED: GraphQL errors — " + JSON.stringify(result.errors).slice(0, 300);
  const userErrors = result.data?.[mutationName]?.userErrors;
  if (userErrors && userErrors.length) {
    return "FAILED: userErrors — " + JSON.stringify(userErrors).slice(0, 300);
  }
  return "OK: " + mutationName + " succeeded for " + context;
}

function normalizePhoneForShopify(phone) {
  if (!phone) return "";
  let raw = String(phone).replace(/[^\d+]/g, "");
  if (raw.charAt(0) === "+") return raw;
  if (raw.length === 11 && raw.charAt(0) === "0") raw = raw.slice(1);
  if (raw.length === 10) return "+91" + raw;
  if (raw.length === 12 && raw.indexOf("91") === 0) return "+" + raw;
  return raw ? "+" + raw : "";
}

function hasUserError(result, mutationName, fieldSubstring) {
  const errors = result?.data?.[mutationName]?.userErrors;
  if (!errors || !errors.length) return false;
  return errors.some((e) => (e.field || []).join(".").toLowerCase().includes(fieldSubstring));
}

async function shopifyFindCustomerByEmail(admin, email) {
  const safeEmail = String(email).replace(/"/g, "");
  const result = await shopifyAdminGraphQL(
    admin,
    `#graphql
    query($q: String!) {
      customers(first: 1, query: $q) {
        edges { node { id tags note emailMarketingConsent { marketingState } } }
      }
    }`,
    { q: "email:" + safeEmail }
  );
  const edges = result?.data?.customers?.edges;
  return edges && edges.length ? edges[0].node : null;
}

async function shopifyAdminGraphQL(admin, query, variables) {
  const res = await admin.graphql(query, { variables: variables || {} });
  const parsed = await res.json();
  if (parsed.errors) {
    console.error("[astroAdvice] Shopify Admin API errors:", JSON.stringify(parsed.errors).slice(0, 300));
  }
  return parsed;
}

/**
 * Sends the personalised gem-recommendation email directly via
 * Nodemailer/Gmail SMTP — same account/behaviour as GmailApp did in the
 * Apps Script version, just called from Node. Requires a Gmail user +
 * App Password (not the account's real password), either saved on the
 * app's own Settings page or set as GMAIL_USER/GMAIL_APP_PASSWORD env
 * vars — see MERGE_ASTRO_ADVICE.md and app/routes/app.settings.jsx.
 */
async function sendGemRecommendationEmail(admin, settings, data, birthDetails, recommendation, trackingId) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail user / app password not set (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }

  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const resultsPageUrl = buildResultsPageUrl(data, birthDetails, recommendation);
  const trackedResultsUrl = appUrl
    ? appUrl + "/track/click?id=" + encodeURIComponent(trackingId) + "&url=" + encodeURIComponent(resultsPageUrl)
    : resultsPageUrl;
  const pixelUrl = appUrl ? appUrl + "/track/open?id=" + encodeURIComponent(trackingId) : null;

  const firstName = (data.name || "").split(" ")[0] || "there";
  const subject = "Your Personalised Gemstone Recommendation";
  const life = recommendation.life || {};

  const shopInfo = await getShopFooterInfo(admin);
  const collectionHandles = [recommendation.life, recommendation.benefic, recommendation.lucky].map((s) => s && s.collection);
  const collectionImages = await getCollectionImages(admin, collectionHandles);

  const htmlBody = buildRecommendationEmailHtml({
    firstName,
    life,
    benefic: recommendation.benefic || {},
    lucky: recommendation.lucky || {},
    resultsUrl: trackedResultsUrl,
    pixelUrl,
    shopInfo,
    collectionImages,
  });

  const plainBody =
    "Hi " + firstName + ",\n\n" +
    "Based on your birth chart, your recommended gemstone is " + (life.gem || "ready") + ".\n\n" +
    "View your full personalised recommendation (Life, Benefic & Lucky stones): " + resultsPageUrl + "\n\n" +
    shopInfo.name;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
  });

  await transporter.sendMail({
    from: '"' + shopInfo.name + '" <' + settings.gmailUser + ">",
    to: data.email,
    subject,
    text: plainBody,
    html: htmlBody,
  });

  try {
    await prisma.emailEvent.create({ data: { trackingId, event: "sent", detail: data.email } });
    await mirrorEmailEventToSheet(settings, trackingId, "sent", data.email);
  } catch (logErr) {
    console.error("[astroAdvice] email sent OK but failed to log 'sent' event:", logErr);
  }

  return "OK: sent to " + data.email;
}

/**
 * Builds the https://<store>/pages/my-gem-recommendation?data=<base64>
 * link — decoded client-side by shubh-gem-recommendation-results.liquid,
 * no login required since the link itself already carries that one
 * person's own data. base64url matches what that page's decode script
 * expects (it also tolerates standard base64 either way).
 */
function buildResultsPageUrl(data, birthDetails, recommendation) {
  const payload = {
    name: data.name || "",
    dob: data.dob || "",
    tob: data.tob || "",
    placeOfBirth: data.placeOfBirth || "",
    ascendant: (birthDetails && birthDetails.ascendant) || "",
    recommendations: recommendation || {},
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return "https://" + STORE_DOMAIN + "/pages/my-gem-recommendation?data=" + encoded;
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Live store info (logo, address, social links, collection images) ---
// Simple in-process cache (module-level, keyed by field) — Render keeps
// this Node process warm between requests (unlike Apps Script's stateless
// per-request execution), so a plain object + timestamp is enough; no
// need for a separate cache service. 6-hour TTL, same as the Code.gs
// version used CacheService for.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let shopFooterInfoCache = null; // { value, expiresAt }
const collectionImageCache = new Map(); // handle -> { value, expiresAt }

async function shopifyAdminGraphQLSimple(admin, query, variables) {
  try {
    const res = await admin.graphql(query, { variables: variables || {} });
    return await res.json();
  } catch (err) {
    console.error("[astroAdvice] GraphQL call failed:", err);
    return null;
  }
}

/**
 * Store name/logo/address/phone/domain, live from the Shop's own Admin
 * API record (name, billingAddress, brand.logo) plus the live theme's
 * social-link settings (social_*_link, same settings schema used
 * throughout sections/*.liquid in this theme). Cached 6 hours since it's
 * identical for every email regardless of which lead triggered it.
 */
async function getShopFooterInfo(admin) {
  if (shopFooterInfoCache && shopFooterInfoCache.expiresAt > Date.now()) {
    return shopFooterInfoCache.value;
  }

  const info = {
    name: "Only Natural Gemstones",
    url: "https://" + STORE_DOMAIN,
    logoUrl: "",
    addressLine: "",
    phone: "",
    email: "info@onlynaturalgemstones.com", // deliberately always info@, not shop.email
    socialLinks: [],
  };

  const result = await shopifyAdminGraphQLSimple(
    admin,
    `#graphql
    query ShopFooter {
      shop {
        name
        primaryDomain { url }
        billingAddress { address1 address2 city province zip country phone }
        brand { logo { image { url } } }
      }
    }`
  );
  const s = result?.data?.shop;
  if (s) {
    info.name = s.name || info.name;
    info.url = s.primaryDomain?.url || info.url;
    info.logoUrl = s.brand?.logo?.image?.url || "";
    if (s.billingAddress) {
      const a = s.billingAddress;
      info.addressLine = [a.address1, a.address2, a.city, a.province, a.zip, a.country].filter(Boolean).join(", ");
      info.phone = a.phone || "";
    }
  }

  info.socialLinks = await getSocialLinksFromTheme(admin);

  shopFooterInfoCache = { value: info, expiresAt: Date.now() + SIX_HOURS_MS };
  return info;
}

// Matches the "Social media" settings block in this theme's
// config/settings_schema.json (social_facebook_link, social_instagram_link,
// etc.) — read live from the published theme's settings_data.json so the
// email's social row always matches whatever's actually configured there.
const SOCIAL_LINK_SETTINGS = [
  { key: "social_facebook_link", label: "Facebook" },
  { key: "social_instagram_link", label: "Instagram" },
  { key: "social_twitter_link", label: "Twitter" },
  { key: "social_pinterest_link", label: "Pinterest" },
  { key: "social_youtube_link", label: "YouTube" },
  { key: "social_tiktok_link", label: "TikTok" },
  { key: "social_snapchat_link", label: "Snapchat" },
  { key: "social_linkedin_link", label: "LinkedIn" },
];

async function getSocialLinksFromTheme(admin) {
  try {
    const themesResult = await shopifyAdminGraphQLSimple(
      admin,
      `#graphql
      query MainTheme { themes(first: 1, roles: [MAIN]) { nodes { id } } }`
    );
    const themeId = themesResult?.data?.themes?.nodes?.[0]?.id;
    if (!themeId) return [];

    const filesResult = await shopifyAdminGraphQLSimple(
      admin,
      `#graphql
      query ThemeSettings($id: ID!) {
        theme(id: $id) {
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
          }
        }
      }`,
      { id: themeId }
    );
    const content = filesResult?.data?.theme?.files?.nodes?.[0]?.body?.content;
    if (!content) return [];

    // Shopify sometimes prepends an auto-generated-file warning comment —
    // strip it before parsing, plain JSON.parse chokes on it otherwise.
    const withoutComment = content.replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, "");
    const parsed = JSON.parse(withoutComment);
    const settings = typeof parsed.current === "string" ? parsed.presets?.[parsed.current] || {} : parsed.current || {};

    return SOCIAL_LINK_SETTINGS.filter((s) => settings[s.key]).map((s) => ({ label: s.label, url: settings[s.key] }));
  } catch (err) {
    console.error("[astroAdvice] getSocialLinksFromTheme failed:", err);
    return [];
  }
}

/**
 * Fetches each recommended collection's own image (not a product image —
 * the recommendation links to a whole collection) via collectionByHandle,
 * one combined query for all three (aliased) rather than three round
 * trips. Cached per-handle for 6 hours since a collection's image rarely
 * changes.
 */
async function getCollectionImages(admin, handles) {
  const images = {};
  const uniqueHandles = [...new Set((handles || []).filter(Boolean))];

  const toFetch = [];
  for (const h of uniqueHandles) {
    const cached = collectionImageCache.get(h);
    if (cached && cached.expiresAt > Date.now()) {
      images[h] = cached.value;
    } else {
      toFetch.push(h);
    }
  }

  if (toFetch.length) {
    try {
      const queryParts = toFetch.map((h, i) => `c${i}: collectionByHandle(handle: ${JSON.stringify(h)}) { image { url } }`);
      const result = await shopifyAdminGraphQLSimple(admin, `#graphql\nquery CollectionImages { ${queryParts.join(" ")} }`);
      toFetch.forEach((h, i) => {
        const url = result?.data?.[`c${i}`]?.image?.url || "";
        images[h] = url;
        collectionImageCache.set(h, { value: url, expiresAt: Date.now() + SIX_HOURS_MS });
      });
    } catch (err) {
      console.error("[astroAdvice] getCollectionImages failed:", err);
    }
  }

  return images;
}

/**
 * One recommendation row — collection image on the left, label/gem name/
 * tagline/Buy Now button on the right. Links to the COLLECTION for that
 * gem (this is a recommended category, not one specific product).
 */
function stoneCard(label, stone, collectionImages) {
  if (!stone || !stone.gem) return "";
  const imgUrl = (stone.collection && collectionImages[stone.collection]) || "";
  const buyUrl = stone.collection ? "https://" + STORE_DOMAIN + "/collections/" + stone.collection : "https://" + STORE_DOMAIN;
  const tagline = GEM_TAGLINE[stone.gem] || "";

  const imageCell = imgUrl
    ? `<img src="${esc(imgUrl)}" width="90" height="90" alt="${esc(stone.gem)}" style="display:block;width:90px;height:90px;object-fit:cover;border-radius:8px;">`
    : `<div style="width:90px;height:90px;border-radius:8px;background:#f4f2ed;"></div>`;

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #eadfd2;">' +
    "<tr>" +
    '<td width="90" style="padding:18px 16px 18px 0;vertical-align:top;">' + imageCell + "</td>" +
    '<td style="padding:18px 0;text-align:center;vertical-align:middle;">' +
    '<p style="margin:0 0 2px;font-size:12px;color:#5c4a3d;">' + esc(label) + " Stone</p>" +
    '<p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#c8712f;">' + esc(stone.gem) + "</p>" +
    (tagline ? '<p style="margin:0 0 12px;font-size:12px;color:#5c4a3d;">' + tagline + "</p>" : "") +
    '<a href="' + esc(buyUrl) + '" style="display:inline-block;background:#8c7a4e;color:#ffffff;font-size:12px;font-weight:bold;letter-spacing:0.5px;text-decoration:none;padding:10px 28px;border-radius:4px;">BUY NOW</a>' +
    "</td>" +
    "</tr></table>"
  );
}

/**
 * Footer — "Thanks for choosing <store>!", bold store name + live
 * address, website/email/phone row, a social-links row (only shown if
 * any are configured), and a small links row.
 */
function footerHtml(shopInfo) {
  const socialRow = shopInfo.socialLinks?.length
    ? '<p style="margin:0 0 12px;font-size:12px;">' +
      shopInfo.socialLinks
        .map((link) => `<a href="${esc(link.url)}" style="color:#8c7a4e;text-decoration:none;margin:0 6px;">${esc(link.label)}</a>`)
        .join("&middot;") +
      "</p>"
    : "";

  return (
    '<tr><td style="background:#faf6f0;padding:24px 32px;text-align:center;border-top:1px solid #eadfd2;">' +
    '<p style="margin:0 0 14px;font-size:13px;color:#3a2408;">Thanks for choosing ' + esc(shopInfo.name) + "!</p>" +
    '<p style="margin:0 0 4px;font-size:12px;color:#5c4a3d;"><strong>' + esc(shopInfo.name) + "</strong>" +
    (shopInfo.addressLine ? ", " + esc(shopInfo.addressLine) : "") +
    "</p>" +
    '<p style="margin:0 0 14px;font-size:12px;color:#8c7a4e;">' +
    '<a href="' + esc(shopInfo.url) + '" style="color:#8c7a4e;text-decoration:none;">' + esc(shopInfo.url.replace(/^https?:\/\//, "")) + "</a>" +
    " &nbsp;&middot;&nbsp; " +
    '<a href="mailto:' + esc(shopInfo.email) + '" style="color:#8c7a4e;text-decoration:none;">' + esc(shopInfo.email) + "</a>" +
    (shopInfo.phone ? ' &nbsp;&middot;&nbsp; <a href="tel:' + esc(shopInfo.phone) + '" style="color:#8c7a4e;text-decoration:none;">' + esc(shopInfo.phone) + "</a>" : "") +
    "</p>" +
    socialRow +
    '<p style="margin:12px 0 0;padding-top:12px;border-top:1px solid #eadfd2;font-size:11px;">' +
    '<a href="' + esc(shopInfo.url) + '/pages/contact" style="color:#8c7a4e;text-decoration:none;margin:0 6px;">Contact Us</a>' +
    '<a href="' + esc(shopInfo.url) + '" style="color:#8c7a4e;text-decoration:none;margin:0 6px;">Online Store</a>' +
    '<a href="' + esc(shopInfo.url) + '/policies/terms-of-service" style="color:#8c7a4e;text-decoration:none;margin:0 6px;">Terms &amp; Conditions</a>' +
    "</p>" +
    "</td></tr>"
  );
}

function buildRecommendationEmailHtml(opts) {
  const shopInfo = opts.shopInfo;
  const headerContent = shopInfo.logoUrl
    ? `<img src="${esc(shopInfo.logoUrl)}" alt="${esc(shopInfo.name)}" style="max-height:40px;max-width:220px;">`
    : `<span style="color:#f4f2ed;font-size:20px;font-weight:bold;letter-spacing:0.5px;">${esc(shopInfo.name)}</span>`;

  return (
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;">' +
    (opts.pixelUrl ? '<img src="' + esc(opts.pixelUrl) + '" width="1" height="1" style="display:none;border:0;" alt="">' : "") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;padding:24px 0;">' +
    "<tr><td align=\"center\">" +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;width:100%;border-radius:8px;overflow:hidden;">' +
    '<tr><td style="background:#3a2408;padding:24px 32px;text-align:center;">' +
    headerContent +
    "</td></tr>" +
    '<tr><td style="padding:32px 32px 8px;">' +
    '<h1 style="margin:0 0 8px;font-size:22px;color:#3a2408;">Hi ' + esc(opts.firstName) + ",</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#5c4a3d;">Based on your birth chart, our Vedic astrology experts have put together your personalised gemstone recommendations below.</p>' +
    "</td></tr>" +
    '<tr><td style="padding:16px 32px 8px;">' +
    stoneCard("Life", opts.life, opts.collectionImages) +
    stoneCard("Benefic", opts.benefic, opts.collectionImages) +
    stoneCard("Lucky", opts.lucky, opts.collectionImages) +
    "</td></tr>" +
    '<tr><td style="padding:16px 32px 32px;text-align:center;">' +
    '<a href="' + esc(opts.resultsUrl) + '" style="display:inline-block;background:#3a2408;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:4px;">View My Full Recommendation &rarr;</a>' +
    "</td></tr>" +
    footerHtml(shopInfo) +
    "</table></td></tr></table></body></html>"
  );
}
