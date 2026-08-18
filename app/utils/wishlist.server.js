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

/**
 * Finds every (shop, email) with a pending (emailSendStatus === null)
 * WishlistLead row whose customer has gone quiet for at least the
 * configured interval, sends ONE email per customer using their latest
 * wishlist snapshot, and marks any older pending rows for that customer
 * as superseded (so a customer who added items 5 times only ever gets
 * one email, not five). Called both by the cron route (on a timer) and
 * the dashboard's manual "Send Due Emails Now" button — same function
 * either way, the button just runs it outside the schedule.
 */
export async function processDueWishlistEmails(admin, shop) {
  const settings = await getAppSettings(shop);
  const intervalHours = parseFloat(settings.wishlistEmailIntervalHours) || DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS;

  const pendingRows = await prisma.wishlistLead.findMany({
    where: { shop, emailSendStatus: null },
    orderBy: { createdAt: "desc" },
  });
  const emails = [...new Set(pendingRows.map((r) => r.email).filter(Boolean))];

  const results = [];
  for (const email of emails) {
    const latest = await prisma.wishlistLead.findFirst({
      where: { shop, email },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) continue;

    if (latest.emailSendStatus) {
      // The truly latest sync for this customer was already resolved
      // (sent, or explicitly skipped) by an earlier run — any older
      // still-pending rows are stale leftovers, close them out.
      await prisma.wishlistLead.updateMany({
        where: { shop, email, emailSendStatus: null, createdAt: { lt: latest.createdAt } },
        data: { emailSendStatus: "skipped: superseded by an already-processed newer sync" },
      });
      continue;
    }

    const ageHours = (Date.now() - new Date(latest.createdAt).getTime()) / (60 * 60 * 1000);
    if (ageHours < intervalHours) {
      results.push({ email, status: `not due yet (${ageHours.toFixed(1)}h of ${intervalHours}h)` });
      continue;
    }

    const handles = Array.isArray(latest.productHandles) ? latest.productHandles : [];
    const products = Array.isArray(latest.products) ? latest.products : [];
    let status;
    try {
      status = await sendWishlistEmail(admin, settings, email, handles, products, latest.trackingId);
    } catch (err) {
      status = "threw: " + err;
      console.error("[wishlist] processDueWishlistEmails send failed for", email, err);
    }

    // WhatsApp goes out on the SAME schedule as the email (once per
    // customer, when they've gone quiet for the interval) — not sent
    // per-sync, same debounce reasoning as the email.
    let whatsappStatus;
    try {
      whatsappStatus = await sendWishlistWhatsAppForLead(settings, latest);
    } catch (err) {
      whatsappStatus = "threw: " + err;
      console.error("[wishlist] processDueWishlistEmails WhatsApp send failed for", email, err);
    }

    try {
      await prisma.wishlistLead.update({ where: { id: latest.id }, data: { emailSendStatus: status, whatsappSendStatus: whatsappStatus } });
      await prisma.wishlistLead.updateMany({
        where: { shop, email, emailSendStatus: null, id: { not: latest.id }, createdAt: { lt: latest.createdAt } },
        data: { emailSendStatus: "skipped: superseded by " + latest.id },
      });
    } catch (updateErr) {
      console.error("[wishlist] failed to record send result:", updateErr);
    }

    results.push({ email, status, whatsappStatus });
  }

  return { checked: emails.length, sent: results.filter((r) => r.status?.startsWith("OK")).length, results };
}

/**
 * Manually (re)sends the wishlist email for one specific, already-saved
 * lead — used by the "Send Now" button on the Wishlist Leads dashboard.
 * Bypasses the interval check entirely (unlike processDueWishlistEmails)
 * since a human explicitly asked for this one, right now.
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
    status = await sendWishlistEmail(admin, settings, lead.email, handles, products, lead.trackingId);
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

function buildWishlistEmailHtml({ firstName, products, shopInfo, pixelUrl, viewAllUrl }) {
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
    '<h1 style="margin:0 0 8px;font-size:22px;color:#3a2408;">Hi ' + esc(firstName) + ",</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#5c4a3d;">Here’s everything you’ve saved to your wishlist — pick up right where you left off.</p>' +
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

async function sendWishlistEmail(admin, settings, email, handles, products, trackingId) {
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
  const subject = products.length === 1 ? "You saved something special" : "Your wishlist is waiting for you";

  const htmlBody = buildWishlistEmailHtml({ firstName, products, shopInfo, pixelUrl, viewAllUrl });
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
