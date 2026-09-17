/**
 * Wishlist "here's what you saved" email + tracking — additive on top of
 * the existing wishlist feature, which keeps working exactly as before
 * (assets/shubh-wishlist.js still syncs to Shopify via the hidden native
 * customer form in theme.liquid, tagging/noting the customer — untouched
 * here). This file only adds: an email showing the wishlisted products,
 * sent whenever the client's own debounced sync fires (see
 * shubh-wishlist.js's performWishlistSync, which now also POSTs to
 * app/routes/proxy.wishlist-sync.jsx alongside its existing form submit),
 * plus the same open/click tracking pattern as the astro-advice email.
 *
 * Mirrors astroAdvice.server.js's structure closely — same tracking
 * mechanism, same shop-info/footer, same Nodemailer/Gmail sending —
 * reusing its exported helpers rather than duplicating them.
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { getAppSettings, DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS } from "./appSettings.server";
import { mirrorEmailEventToSheet, mirrorWishlistLeadToSheet } from "./googleSheets.server";
import { STORE_DOMAIN, trackedClickUrl, esc, getShopFooterInfo, footerHtml, FALLBACK_LOGO_URL } from "./astroAdvice.server";
import { sendWishlistWhatsApp } from "./interakt.server";

/** Thin wrapper around interakt.server.js's sendWishlistWhatsApp, taking
 * a WishlistLead-shaped object directly (same convenience pattern as
 * astroAdvice.server.js's sendWhatsAppForLead) so call sites don't need
 * to destructure the same four fields every time. */
async function sendWishlistWhatsAppForLead(settings, lead) {
  if (!lead.phone) return "skipped: no phone on lead";
  return sendWishlistWhatsApp(settings, {
    phone: lead.phone,
    email: lead.email,
    products: Array.isArray(lead.products) ? lead.products : [],
    productHandles: Array.isArray(lead.productHandles) ? lead.productHandles : [],
    headerImageUrl: FALLBACK_LOGO_URL,
  });
}

/**
 * Main entry point, called from proxy.wishlist-sync.jsx. ONLY saves the
 * sync to the database (source of truth for the Wishlist Leads
 * dashboard) — no email sent here anymore. Sending is entirely handled
 * by processDueWishlistEmails below, run on a timer (see
 * app/routes/cron.wishlist-email.jsx) or on-demand from the dashboard's
 * "Send Due Emails Now" button — see app.wishlist-leads.jsx.
 */
export async function handleWishlistSync(admin, shop, data) {
  const email = (data.email || "").trim();
  const handles = Array.isArray(data.productHandles) ? data.productHandles.filter(Boolean) : [];
  if (!email || !handles.length) {
    return { error: "email and at least one productHandle are required" };
  }

  const trackingId = crypto.randomUUID();

  // Resolved once, up front, so the database row (for the Wishlist Leads
  // dashboard's item details, and later reused as-is when the email
  // actually sends) has real product data from the start.
  const products = await getProductsByHandles(admin, handles);

  let lead;
  try {
    lead = await prisma.wishlistLead.create({
      data: {
        trackingId,
        shop: shop || null,
        email,
        phone: data.phone || null,
        productHandles: handles,
        products,
        // emailSendStatus stays null (pending) — processDueWishlistEmails
        // picks this up once the configured interval has passed since
        // the customer's LATEST sync (this row, unless a newer one
        // arrives before then, which pushes the debounce point out).
      },
    });
  } catch (dbErr) {
    console.error("[wishlist] failed to save lead to database:", dbErr);
    return { error: "Failed to save" };
  }

  // Fire-and-forget, same reasoning as astroAdvice.server.js's background
  // tasks — this route runs under the Shopify App Proxy's response-time
  // limit, and the client-side caller already does a bare
  // fetch(...).catch(()=>{}) without reading the response, so nothing is
  // lost by not awaiting this. Also called far more often than an astro
  // lead submission (every debounced wishlist-toggle sync, not just once
  // per form fill), so keeping this off the request's critical path
  // matters even more here.
  const settings = await getAppSettings(shop);
  const mirrorPromise = mirrorWishlistLeadToSheet(settings, lead).catch(
    (err) => "threw: " + String((err && err.message) || err)
  );

  // TEMPORARY: {"debug": true} in the request body awaits the mirror
  // call and reports its real status instead of firing-and-forgetting it
  // — for diagnosing exactly what happens server-side without needing
  // Render's logs. Never triggered by the real theme JS (only sends
  // email/phone/productHandles), so this never adds latency to a real
  // customer's sync.
  if (data.debug === true) {
    const sheetMirrorStatus = await mirrorPromise;
    return { ok: true, emailSendStatus: "pending: scheduled for the next interval check", sheetMirrorStatus, shop, hasRelayUrl: !!settings.sheetsRelayUrl };
  }

  return { ok: true, emailSendStatus: "pending: scheduled for the next interval check" };
}

// The 3-stage wishlist reminder EMAIL sequence, per explicit request:
// 5 minutes / 1 hour / 24 hours after the customer's LATEST wishlist
// activity (not their first) -- adding another item resets the whole
// sequence, same "debounced by latest activity" reasoning the old
// single-reminder design already used. statusField/sentAtField name
// the WishlistLead columns each stage reads/writes (see schema.prisma).
const WISHLIST_EMAIL_STAGES = [
  { stage: 1, minutesAfterActivity: 5, statusField: "emailSendStatus", sentAtField: "emailStage1SentAt" },
  { stage: 2, minutesAfterActivity: 60, statusField: "emailStage2Status", sentAtField: "emailStage2SentAt" },
  { stage: 3, minutesAfterActivity: 60 * 24, statusField: "emailStage3Status", sentAtField: "emailStage3SentAt" },
];

/**
 * Finds every (shop, email) still mid-sequence (stage 3 not yet
 * resolved) on their LATEST WishlistLead row, sends whichever ONE stage
 * is now due and hasn't gone out yet, and marks any OLDER row for that
 * customer as fully superseded (so a customer who added items 5 times
 * only ever progresses through the sequence for their most recent
 * activity, not five parallel sequences). Only ever sends ONE stage per
 * customer per run, even if the check was delayed long enough that two
 * stages are technically due at once -- otherwise a customer whose
 * checker was offline for a day could get stage 1 AND stage 2 back to
 * back in the same run, which reads as spammy rather than a sequence.
 * The next-due stage simply goes out on the following run instead.
 *
 * WhatsApp is checked independently in the same pass -- still a single
 * reminder (not part of the 3-stage sequence), gated by the Settings
 * page's own wait-time setting, per explicit request to keep its timing
 * separate from the email schedule.
 *
 * Called both by the cron route (on a timer -- see
 * app/routes/cron.wishlist-email.jsx, which now needs to run roughly
 * every 5 minutes for stage 1 to be reasonably prompt) and the
 * dashboard's manual "Send Due Emails Now" button — same function
 * either way, the button just runs it outside the schedule.
 */
export async function processDueWishlistEmails(admin, shop) {
  const settings = await getAppSettings(shop);

  const candidateRows = await prisma.wishlistLead.findMany({
    where: { shop, emailStage3Status: null },
    orderBy: { createdAt: "desc" },
    select: { email: true },
  });
  const emails = [...new Set(candidateRows.map((r) => r.email).filter(Boolean))];

  const results = [];
  for (const email of emails) {
    const latest = await prisma.wishlistLead.findFirst({
      where: { shop, email },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) continue;

    // Any OLDER row for this customer is superseded the instant a newer
    // sync exists -- one targeted updateMany per field (not one
    // combined query) so a field that already holds a REAL result (an
    // actual "OK: ..."/"FAILED: ..." send, from before this newer sync
    // arrived) is never overwritten, only genuinely-still-null ones.
    await prisma.wishlistLead.updateMany({
      where: { shop, email, id: { not: latest.id }, emailSendStatus: null },
      data: { emailSendStatus: "skipped: superseded by a newer wishlist sync" },
    });
    await prisma.wishlistLead.updateMany({
      where: { shop, email, id: { not: latest.id }, emailStage2Status: null },
      data: { emailStage2Status: "skipped: superseded by a newer wishlist sync" },
    });
    await prisma.wishlistLead.updateMany({
      where: { shop, email, id: { not: latest.id }, emailStage3Status: null },
      data: { emailStage3Status: "skipped: superseded by a newer wishlist sync" },
    });
    await prisma.wishlistLead.updateMany({
      where: { shop, email, id: { not: latest.id }, whatsappSendStatus: null },
      data: { whatsappSendStatus: "skipped: superseded by a newer wishlist sync" },
    });

    const elapsedMinutes = (Date.now() - new Date(latest.createdAt).getTime()) / 60000;
    const handles = Array.isArray(latest.productHandles) ? latest.productHandles : [];
    const products = Array.isArray(latest.products) ? latest.products : [];

    for (const stageDef of WISHLIST_EMAIL_STAGES) {
      if (latest[stageDef.statusField]) continue; // this stage already resolved -- check the next one
      if (elapsedMinutes < stageDef.minutesAfterActivity) break; // not due yet, and later stages are further out still

      let status;
      try {
        status = await sendWishlistEmail(admin, settings, email, handles, products, latest.trackingId, stageDef.stage);
      } catch (err) {
        status = "threw: " + err;
        console.error(`[wishlist] stage ${stageDef.stage} email failed for`, email, err);
      }
      try {
        await prisma.wishlistLead.update({
          where: { id: latest.id },
          data: { [stageDef.statusField]: status, [stageDef.sentAtField]: new Date() },
        });
      } catch (updateErr) {
        console.error("[wishlist] failed to record stage send result:", updateErr);
      }
      results.push({ email, stage: stageDef.stage, status });
      break; // one stage per customer per run -- see doc comment above
    }

    if (!latest.whatsappSendStatus) {
      const intervalHours = parseFloat(settings.wishlistEmailIntervalHours) || DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS;
      if (elapsedMinutes / 60 >= intervalHours) {
        let whatsappStatus;
        try {
          whatsappStatus = await sendWishlistWhatsAppForLead(settings, latest);
        } catch (err) {
          whatsappStatus = "threw: " + err;
          console.error("[wishlist] processDueWishlistEmails WhatsApp send failed for", email, err);
        }
        try {
          await prisma.wishlistLead.update({ where: { id: latest.id }, data: { whatsappSendStatus } });
        } catch (updateErr) {
          console.error("[wishlist] failed to record WhatsApp send result:", updateErr);
        }
        results.push({ email, channel: "whatsapp", status: whatsappStatus });
      }
    }
  }

  return { checked: emails.length, sent: results.filter((r) => r.status?.startsWith("OK")).length, results };
}

/**
 * Manually (re)sends the wishlist email for one specific, already-saved
 * lead — used by the "Send Now" button on the Wishlist Leads dashboard.
 * Bypasses the interval check entirely (unlike processDueWishlistEmails)
 * since a human explicitly asked for this one, right now. Always sends
 * stage 1's content specifically -- a manual ad-hoc resend isn't part of
 * the automatic 3-stage sequence, so there's no "which stage is next"
 * question to answer; stage 1 is simply the reminder content people
 * mean by "send now".
 */
export async function resendWishlistLeadEmail(admin, leadId) {
  const lead = await prisma.wishlistLead.findUnique({ where: { id: leadId } });
  if (!lead) return "error: lead not found";
  if (!lead.email) return "skipped: lead has no email";

  const settings = await getAppSettings(lead.shop);
  const handles = Array.isArray(lead.productHandles) ? lead.productHandles : [];
  const products = Array.isArray(lead.products) ? lead.products : [];

  let status;
  try {
    status = await sendWishlistEmail(admin, settings, lead.email, handles, products, lead.trackingId, 1);
  } catch (err) {
    status = "threw: " + err;
    console.error("[wishlist] resendWishlistLeadEmail failed:", err);
  }

  try {
    await prisma.wishlistLead.update({ where: { id: leadId }, data: { emailSendStatus: status } });
  } catch (updateErr) {
    console.error("[wishlist] failed to record resend result:", updateErr);
  }

  return status;
}

/**
 * Manual retry for one specific lead's WhatsApp message — mirrors
 * resendWishlistLeadEmail's shape exactly, but for
 * sendWishlistWhatsAppForLead, and app.astro-leads.jsx's resendWhatsapp
 * intent (same pattern: a dedicated Retry button separate from the
 * email's Send Now, since the two can succeed/fail independently).
 */
export async function resendWishlistWhatsapp(leadId) {
  const lead = await prisma.wishlistLead.findUnique({ where: { id: leadId } });
  if (!lead) return "error: lead not found";

  const settings = await getAppSettings(lead.shop);
  let status;
  try {
    status = await sendWishlistWhatsAppForLead(settings, lead);
  } catch (err) {
    status = "threw: " + err;
    console.error("[wishlist] resendWishlistWhatsapp failed:", err);
  }

  try {
    await prisma.wishlistLead.update({ where: { id: leadId }, data: { whatsappSendStatus: status } });
  } catch (updateErr) {
    console.error("[wishlist] failed to record WhatsApp resend result:", updateErr);
  }

  return status;
}

/** Fetches title/image/price for each handle in one aliased GraphQL call
 * (same pattern as astroAdvice.server.js's getCollectionImages) — skips
 * any handle that fails to resolve (unpublished/deleted product) rather
 * than failing the whole email over one bad item. */
async function getProductsByHandles(admin, handles) {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return [];

  try {
    const queryParts = unique.map(
      (h, i) =>
        `p${i}: productByHandle(handle: ${JSON.stringify(h)}) { title handle featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } }`
    );
    const res = await admin.graphql(`#graphql\nquery WishlistProducts { ${queryParts.join(" ")} }`);
    const json = await res.json();
    return unique
      .map((h, i) => {
        const p = json?.data?.[`p${i}`];
        if (!p) return null;
        return {
          handle: h,
          title: p.title,
          imageUrl: p.featuredImage?.url || "",
          price: p.priceRangeV2?.minVariantPrice?.amount || null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error("[wishlist] getProductsByHandles failed:", err);
    return [];
  }
}

function formatRupees(amount) {
  if (!amount) return "";
  return "₹" + Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

function wishlistItemRow(product, trackingCtx) {
  const rawUrl = "https://" + STORE_DOMAIN + "/products/" + product.handle;
  const buyUrl = trackedClickUrl(trackingCtx.appUrl, trackingCtx.trackingId, rawUrl, "wishlist_" + product.handle + "_buy_now");
  const imageCell = product.imageUrl
    ? `<img src="${esc(product.imageUrl)}" width="80" height="80" alt="${esc(product.title)}" style="display:block;width:80px;height:80px;object-fit:cover;border-radius:10px;">`
    : `<div style="width:80px;height:80px;border-radius:10px;background:#f4f2ed;"></div>`;

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #eadfd2;">' +
    "<tr>" +
    '<td width="80" style="padding:16px 16px 16px 0;vertical-align:top;">' + imageCell + "</td>" +
    '<td style="padding:16px 0;vertical-align:middle;">' +
    '<p style="margin:0 0 4px;font-size:15px;font-weight:bold;color:#3a2408;">' + esc(product.title) + "</p>" +
    (product.price ? '<p style="margin:0 0 10px;font-size:14px;color:#8c7a4e;">' + formatRupees(product.price) + "</p>" : "") +
    '<a href="' + esc(buyUrl) + '" style="display:inline-block;background:#8c7a4e;color:#ffffff;font-size:12px;font-weight:bold;letter-spacing:0.5px;text-decoration:none;padding:9px 24px;border-radius:4px;">BUY NOW</a>' +
    "</td>" +
    "</tr></table>"
  );
}

// Distinct wording for each of the 3 sequence stages, per explicit
// request ("gentle nudge, then more urgency, then a final reminder").
// Stage 1 keeps the original single-reminder copy unchanged. Stages 2/3
// lean on genuine scarcity (every gemstone is a real, one-of-a-kind
// natural stone, not a manufactured item that gets restocked) rather
// than an artificial countdown-timer style urgency, matching the site's
// existing brand voice elsewhere (certified/natural/one-of-a-kind).
const WISHLIST_STAGE_COPY = {
  1: {
    subjectSingle: "You saved something special",
    subjectMultiple: "Your wishlist is waiting for you",
    headline: (firstName) => "Hi " + firstName + ",",
    intro: "Here’s everything you’ve saved to your wishlist — pick up right where you left off.",
  },
  2: {
    subjectSingle: "Still thinking it over?",
    subjectMultiple: "Your saved gemstones are still waiting",
    headline: (firstName) => "Hi " + firstName + ", still deciding?",
    intro:
      "Your saved gemstones are still here — but every one is a genuinely one-of-a-kind natural stone, not a mass-produced item, so once it's gone there won't be another exactly like it.",
  },
  3: {
    subjectSingle: "Last chance to claim your pick",
    subjectMultiple: "Last chance for your saved gemstones",
    headline: (firstName) => "Hi " + firstName + ", one last look",
    intro:
      "This is your final reminder — the gemstones below are natural and one-of-a-kind, so once someone else claims them, they're gone for good.",
  },
};

function buildWishlistEmailHtml({ firstName, products, shopInfo, pixelUrl, viewAllUrl, stageCopy }) {
  const headerContent = shopInfo.logoUrl
    ? `<img src="${esc(shopInfo.logoUrl)}" alt="${esc(shopInfo.name)}" style="max-height:44px;max-width:220px;">`
    : `<span style="color:#3a2408;font-size:20px;font-weight:bold;letter-spacing:0.5px;">${esc(shopInfo.name)}</span>`;

  const itemsHtml = products.length
    ? products.map((p) => wishlistItemRow(p, { appUrl: shopInfo._appUrl, trackingId: shopInfo._trackingId })).join("")
    : '<p style="margin:0;font-size:14px;color:#5c4a3d;">Your saved items are ready whenever you are.</p>';

  return (
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;">' +
    (pixelUrl ? '<img src="' + esc(pixelUrl) + '" width="1" height="1" style="display:none;border:0;" alt="">' : "") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;padding:24px 0;">' +
    "<tr><td align=\"center\">" +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(58,36,8,0.08);">' +
    '<tr><td style="background:linear-gradient(90deg,#c8944a,#8c7a4e);height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>' +
    '<tr><td style="background:#faf6f0;padding:22px 32px;text-align:center;border-bottom:1px solid #eadfd2;">' +
    headerContent +
    "</td></tr>" +
    '<tr><td style="padding:32px 32px 8px;">' +
    '<h1 style="margin:0 0 8px;font-size:22px;color:#3a2408;">' + esc(stageCopy.headline(firstName)) + "</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#5c4a3d;">' + esc(stageCopy.intro) + "</p>" +
    "</td></tr>" +
    '<tr><td style="padding:8px 32px 4px;">' +
    '<p style="margin:0;text-align:center;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c8944a;">&#10022;&nbsp;&nbsp;Your Wishlist&nbsp;&nbsp;&#10022;</p>' +
    "</td></tr>" +
    '<tr><td style="padding:8px 32px 8px;">' + itemsHtml + "</td></tr>" +
    '<tr><td style="padding:16px 32px 32px;text-align:center;">' +
    '<a href="' + esc(viewAllUrl) + '" style="display:inline-block;background:#3a2408;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:4px;">View Full Wishlist &rarr;</a>' +
    "</td></tr>" +
    footerHtml(shopInfo, { appUrl: shopInfo._appUrl, trackingId: shopInfo._trackingId }) +
    "</table></td></tr></table></body></html>"
  );
}

/** stage: 1/2/3, selecting which of WISHLIST_STAGE_COPY's wording to
 * send — defaults to 1 (the original single-reminder copy) so any
 * existing call site that doesn't pass a stage keeps working unchanged. */
async function sendWishlistEmail(admin, settings, email, handles, products, trackingId, stage = 1) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail user / app password not set (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }

  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const shopInfo = await getShopFooterInfo(admin);
  // Stashed on shopInfo so wishlistItemRow/footerHtml (which only take
  // shopInfo) can still build tracked links without threading two more
  // params through every call site.
  shopInfo._appUrl = appUrl;
  shopInfo._trackingId = trackingId;

  const pixelUrl = appUrl ? appUrl + "/track/open?id=" + encodeURIComponent(trackingId) : null;
  // The wishlist drawer already knows how to render a list of handles
  // via ?shared_wishlist=handle1,handle2 (see checkForSharedWishlist in
  // shubh-wishlist.js) — reusing that existing mechanism instead of
  // building a new results page.
  const viewAllRaw = "https://" + STORE_DOMAIN + "/?shared_wishlist=" + handles.map(encodeURIComponent).join(",");
  const viewAllUrl = trackedClickUrl(appUrl, trackingId, viewAllRaw, "view_full_wishlist");

  const firstName = email.split("@")[0];
  const stageCopy = WISHLIST_STAGE_COPY[stage] || WISHLIST_STAGE_COPY[1];
  const subject = products.length === 1 ? stageCopy.subjectSingle : stageCopy.subjectMultiple;

  const htmlBody = buildWishlistEmailHtml({ firstName, products, shopInfo, pixelUrl, viewAllUrl, stageCopy });
  const plainBody =
    "Hi,\n\nHere's what's in your wishlist: " +
    (products.length ? products.map((p) => p.title).join(", ") : handles.join(", ")) +
    "\n\nView your full wishlist: " + viewAllRaw + "\n\n" + shopInfo.name;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
  });

  await transporter.sendMail({
    from: '"' + shopInfo.name + '" <' + settings.gmailUser + ">",
    to: email,
    subject,
    text: plainBody,
    html: htmlBody,
  });

  try {
    await prisma.emailEvent.create({ data: { trackingId, event: "sent", detail: email } });
    await mirrorEmailEventToSheet(settings, trackingId, "sent", email);
  } catch (logErr) {
    console.error("[wishlist] email sent OK but failed to log 'sent' event:", logErr);
  }

  return "OK: sent to " + email;
}
