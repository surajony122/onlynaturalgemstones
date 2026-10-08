/**
 * Abandoned checkout reminder email, sent by this app through the shop's own
 * Gmail connection (same sender as the order-processing and recommendation
 * emails), instead of through Shopify Flow / Shopify Messaging.
 *
 * How it works
 *   1. A scheduled sweep (cron.abandoned-checkouts.jsx, and piggy-backed on the
 *      5-minute order catch-up job) asks Shopify for recent abandoned checkouts.
 *   2. Each checkout is judged by decideCheckout() below. It is emailed only if
 *      it is idle for the configured delay, the customer agreed to email
 *      marketing, has not ordered since, has not unsubscribed, and has not been
 *      emailed in the last 24 hours.
 *   3. The email goes out ONCE per checkout. The AbandonedCheckoutEmail row is
 *      created before sending as an atomic claim (checkoutId is unique), so two
 *      overlapping runs can never both send. The row also keeps a snapshot of
 *      what was sent, so a failed send can be retried from the Overview.
 *
 * Safety: the feature is OFF until switched on in Settings -> Emails, and once on
 * it only ever looks at checkouts created AFTER that moment, so enabling it
 * never mails a backlog. "Check who would get one" (dryRun) shows the decisions
 * without sending anything.
 */
import crypto from "crypto";
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { getAppSettings } from "./appSettings.server";
import { esc, getShopFooterInfo, FALLBACK_LOGO_URL } from "./astroAdvice.server";

export const DEFAULT_DELAY_MINUTES = 60;
const MIN_DELAY_MINUTES = 15;
const MAX_DELAY_MINUTES = 3 * 24 * 60;
const MAX_AGE_DAYS = 3;
const MAX_SENDS_PER_RUN = 10;
const FETCH_LIMIT = 50;
const PER_ADDRESS_COOLDOWN_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const FALLBACK_APP_URL = "https://shubh-gems-customizer-app.onrender.com";

// ---------------------------------------------------------------- template

export const ABANDONED_CHECKOUT_EMAIL_PLACEHOLDERS = [
  { token: "customer_first_name", description: "Customer's first name (\"there\" if unknown)" },
  { token: "items_html", description: "The cart items, with photo, name, variant and quantity (generated automatically)" },
  { token: "item_count", description: "Number of items in the cart" },
  { token: "total", description: "Cart total, e.g. ₹81,700.00" },
  { token: "checkout_url", description: "Link that takes the customer back to their saved checkout" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store web address" },
  { token: "shop_logo_url", description: "Store logo image address" },
  { token: "unsubscribe_url", description: "Link that stops further cart reminders for this email address" },
];

export const DEFAULT_ABANDONED_SUBJECT = "Your gemstone is still waiting";

export const DEFAULT_ABANDONED_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>You left something in your cart</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style type="text/css">
    body { margin: 0; padding: 0; width: 100%; background-color: #f3f2ef; font-family: Arial, Helvetica, sans-serif; color: #4f5965; }
    table { border-collapse: collapse; }
    img { border: 0; display: block; }
    a { color: #8c7a4e; }
    .page-padding { padding: 24px 12px; }
    .email-container { width: 500px; max-width: 100%; background-color: #ffffff; border-radius: 0 0 12px 12px; overflow: hidden; }
    .logo-section { padding: 28px 20px 25px; text-align: center; background-color: #fffcf3; border-top: 5px solid #8c7a4e; }
    .divider { height: 1px; background-color: #d5d0c8; width: 100%; font-size: 1px; line-height: 1px; }
    .content-section { padding: 30px 28px 10px; font-size: 15px; line-height: 1.6; color: #4f5965; background-color: #ffffff; }
    .content-section p { margin-top: 0; margin-bottom: 16px; }
    .headline { font-size: 22px; line-height: 1.3; font-weight: normal; color: #3d4652; margin: 0 0 14px; }
    .button-cell { padding: 22px 28px 8px; text-align: center; }
    .email-button { display: inline-block; background-color: #8c7a4e; color: #ffffff !important; padding: 13px 34px; font-size: 15px; font-weight: bold; border-radius: 3px; text-decoration: none !important; }
    .note-section { padding: 18px 28px 6px; font-size: 14px; line-height: 1.6; color: #4f5965; }
    .note-box { background-color: #fffcf3; border-left: 3px solid #8c7a4e; padding: 12px 16px; }
    .footer-section { padding: 20px 28px 26px; text-align: center; font-size: 12px; line-height: 1.6; color: #7b8590; background-color: #ffffff; }
    .footer-section a { color: #7b8590; }
    @media only screen and (max-width: 520px) {
      .content-section { padding: 24px 18px 8px !important; }
      .button-cell, .note-section, .footer-section { padding-left: 18px !important; padding-right: 18px !important; }
      .email-button { display: block !important; padding: 14px 10px !important; }
    }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f2ef;">
    <tr>
      <td class="page-padding" align="center">
        <table class="email-container" width="500" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td class="logo-section">
              <a href="{{shop_url}}" style="text-decoration:none;">
                <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="140" style="margin:0 auto; max-width:140px; width:140px; height:auto;">
              </a>
            </td>
          </tr>
          <tr><td><div class="divider">&nbsp;</div></td></tr>

          <tr>
            <td class="content-section">
              <p>Hello {{customer_first_name}},</p>
              <h1 class="headline">You left something beautiful in your cart.</h1>
              <p>
                Your gemstone is still waiting for you. Every stone we sell is a single, natural piece, so once it is
                bought by someone else it is gone for good.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 6px 28px 6px;">
              {{items_html}}
              <p style="margin:10px 2px 0; font-size:13px; color:#7b8590;">{{item_count}} in your cart &middot; Total <strong style="color:#3d4652;">{{total}}</strong></p>
            </td>
          </tr>

          <tr>
            <td class="button-cell">
              <a class="email-button" href="{{checkout_url}}">Complete my order</a>
            </td>
          </tr>

          <tr>
            <td class="note-section">
              <div class="note-box">
                Need help choosing, or have a question about a stone? Just reply to this email and our team will get back to you.
              </div>
            </td>
          </tr>

          <tr><td style="padding: 14px 28px 0;"><div class="divider">&nbsp;</div></td></tr>

          <tr>
            <td class="footer-section">
              <div style="margin-bottom: 6px;"><a href="{{shop_url}}" style="font-weight:bold;">{{shop_name}}</a></div>
              <div style="margin-bottom: 10px;">You are receiving this email because you left items in your cart at {{shop_name}}.</div>
              <div><a href="{{unsubscribe_url}}">Unsubscribe from cart reminders</a></div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

export function getAbandonedCheckoutEmailTemplate(settings) {
  const v = settings && settings.abandonedCheckoutEmailTemplate;
  return v && String(v).trim() ? String(v) : DEFAULT_ABANDONED_TEMPLATE;
}

export function getAbandonedCheckoutEmailSubject(settings) {
  const v = settings && settings.abandonedCheckoutEmailSubject;
  return v && String(v).trim() ? String(v) : DEFAULT_ABANDONED_SUBJECT;
}

export function renderAbandonedTemplate(template, vars) {
  let out = String(template || "");
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value).split(`{{ ${key} }}`).join(value);
  }
  return out;
}

// ---------------------------------------------------------------- unsubscribe links

function appBaseUrl() {
  return (process.env.SHOPIFY_APP_URL || FALLBACK_APP_URL).replace(/\/$/, "");
}

function unsubscribeToken(email) {
  return crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(String(email).toLowerCase()).digest("hex").slice(0, 32);
}

export function buildUnsubscribeUrl(email) {
  const e = Buffer.from(String(email).toLowerCase(), "utf8").toString("base64url");
  return `${appBaseUrl()}/unsubscribe-abandoned?e=${e}&t=${unsubscribeToken(email)}`;
}

/** Returns the email address if the link's signature is valid, otherwise null. */
export function readUnsubscribeLink(e, t) {
  try {
    const email = Buffer.from(String(e || ""), "base64url").toString("utf8").trim().toLowerCase();
    if (!email || !email.includes("@")) return null;
    const expected = Buffer.from(unsubscribeToken(email));
    const given = Buffer.from(String(t || ""));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    return email;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- reading checkouts from Shopify

const CHECKOUTS_QUERY = `#graphql
  query AbandonedCheckoutsForReminder($first: Int!, $query: String!) {
    abandonedCheckouts(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        id
        name
        createdAt
        updatedAt
        completedAt
        abandonedCheckoutUrl
        customAttributes { key value }
        totalPriceSet { shopMoney { amount currencyCode } }
        customer {
          firstName
          lastName
          email
          emailMarketingConsent { marketingState }
          lastOrder { createdAt }
        }
        lineItems(first: 10) {
          nodes {
            title
            quantity
            variantTitle
            image { url }
            customAttributes { key value }
          }
        }
      }
    }
  }`;

function attrMap(list) {
  const m = {};
  (list || []).forEach((a) => {
    if (a && a.key) m[a.key] = a.value;
  });
  return m;
}

/** Shopify's checkout node -> the small, plain object the rest of this file works with. */
export function normaliseCheckout(node) {
  const attrs = attrMap(node.customAttributes);
  const customer = node.customer || {};
  const money = node.totalPriceSet && node.totalPriceSet.shopMoney;
  const items = ((node.lineItems && node.lineItems.nodes) || []).map((li) => {
    const la = attrMap(li.customAttributes);
    return {
      title: li.title || "Item",
      variantTitle: li.variantTitle || "",
      quantity: li.quantity || 1,
      // Customisation lines have no product photo of their own, but carry the chosen design image.
      imageUrl: (li.image && li.image.url) || la["_Design Image"] || "",
    };
  });
  return {
    id: node.id,
    name: node.name || "",
    createdAt: node.createdAt || null,
    updatedAt: node.updatedAt || node.createdAt || null,
    completedAt: node.completedAt || null,
    url: node.abandonedCheckoutUrl || "",
    email: String(customer.email || "").trim().toLowerCase(),
    firstName: customer.firstName || "",
    fullName: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    // Either Shopify's own record, or the consent tick the checkout itself saved (Razorpay Magic Checkout does this).
    consent:
      (customer.emailMarketingConsent && customer.emailMarketingConsent.marketingState === "SUBSCRIBED") ||
      String(attrs.checkout_email_consent || "").toLowerCase() === "true",
    lastOrderAt: (customer.lastOrder && customer.lastOrder.createdAt) || null,
    total: money ? { amount: money.amount, currency: money.currencyCode } : null,
    items,
  };
}

async function fetchRecentCheckouts(admin, sinceDate) {
  const res = await admin.graphql(CHECKOUTS_QUERY, { variables: { first: FETCH_LIMIT, query: `created_at:>='${sinceDate.toISOString()}'` } });
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error("Shopify said: " + json.errors.map((e) => e.message).join("; "));
  }
  return ((json.data && json.data.abandonedCheckouts && json.data.abandonedCheckouts.nodes) || []).map(normaliseCheckout);
}

// ---------------------------------------------------------------- the decision (pure, no I/O)

/**
 * Decides what to do with one checkout.
 *   action "send"  -> email it now
 *   action "wait"  -> not due yet, look again next run
 *   action "skip"  -> never email it; `record` says whether to write that down
 */
export function decideCheckout(c, ctx) {
  const { nowMs, delayMs, sinceMs, handledIds, optedOut, recentlyEmailed } = ctx;
  if (handledIds.has(c.id)) return { action: "skip", reason: "already handled", record: false };
  if (c.completedAt) return { action: "skip", reason: "the customer completed this checkout", record: false };
  if (!c.items.length) return { action: "skip", reason: "no items in the cart", record: false };
  if (!c.email) return { action: "skip", reason: "no email address on this checkout", record: false };
  if (new Date(c.createdAt).getTime() < sinceMs) return { action: "skip", reason: "created before the reminder was switched on (or older than 3 days)", record: false };
  if (optedOut.has(c.email)) return { action: "skip", reason: "this address unsubscribed from cart reminders", record: true };
  if (!c.consent) return { action: "skip", reason: "no email marketing consent", record: true };
  if (c.lastOrderAt && new Date(c.lastOrderAt).getTime() >= new Date(c.createdAt).getTime()) {
    return { action: "skip", reason: "the customer placed an order after this checkout", record: true };
  }
  const idleMs = nowMs - new Date(c.updatedAt || c.createdAt).getTime();
  if (idleMs < delayMs) {
    return { action: "wait", reason: `not due yet (sends in about ${Math.max(1, Math.ceil((delayMs - idleMs) / 60000))} min)`, record: false };
  }
  if (recentlyEmailed.has(c.email)) return { action: "skip", reason: `this address was already emailed in the last ${PER_ADDRESS_COOLDOWN_HOURS} hours`, record: true };
  return { action: "send", reason: "ready to send", record: false };
}

// ---------------------------------------------------------------- building and sending the email

function formatMoney(total) {
  if (!total || total.amount == null) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: total.currency || "INR", minimumFractionDigits: 2 }).format(Number(total.amount));
  } catch {
    return `${total.currency || ""} ${total.amount}`;
  }
}

export function buildItemsHtml(items) {
  const rows = items
    .map((it) => {
      const img = it.imageUrl
        ? `<img src="${esc(it.imageUrl)}" alt="${esc(it.title)}" width="72" height="72" style="width:72px;height:72px;object-fit:cover;border-radius:6px;display:block;">`
        : "";
      const variant = it.variantTitle && it.variantTitle !== "Default Title" ? `<p style="margin:0;font-size:13px;line-height:1.4;color:#7b8590;">${esc(it.variantTitle)}</p>` : "";
      return (
        `<tr>` +
        `<td width="72" style="padding:14px 0 14px 14px;border-bottom:1px solid #ebe3cf;vertical-align:middle;">${img}</td>` +
        `<td style="padding:14px;border-bottom:1px solid #ebe3cf;vertical-align:middle;">` +
        `<p style="margin:0 0 3px;font-size:15px;line-height:1.4;font-weight:bold;color:#3d4652;">${esc(it.title)}</p>` +
        variant +
        `<p style="margin:0;font-size:13px;line-height:1.4;color:#7b8590;">Qty: ${esc(it.quantity)}</p>` +
        `</td></tr>`
      );
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fffcf3;border:1px solid #ebe3cf;border-radius:8px;">${rows}</table>`;
}

export function buildEmailVars(checkout, shopInfo) {
  const first = (checkout.firstName || "").trim() || "there";
  const count = checkout.items.reduce((n, it) => n + (Number(it.quantity) || 1), 0);
  const raw = {
    customer_first_name: first,
    item_count: `${count} item${count === 1 ? "" : "s"}`,
    total: formatMoney(checkout.total),
    checkout_url: checkout.url,
    shop_name: shopInfo.name,
    shop_url: shopInfo.url,
    shop_logo_url: shopInfo.logoUrl,
    unsubscribe_url: buildUnsubscribeUrl(checkout.email),
  };
  // HTML context: every value escaped, except the generated items block, which is already safe markup.
  const html = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, esc(v)]));
  html.items_html = buildItemsHtml(checkout.items);
  return { raw, html };
}

/**
 * Sends the reminder for one (normalised) checkout. Used by the sweep, by
 * "Send a test email" and by Retry. Returns "OK: sent to ..." or an
 * explanation ("skipped: ..." / throws on a mail error).
 */
export async function sendAbandonedCheckoutEmail(admin, settings, checkout) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail not configured (Settings -> Connections)";
  }
  if (!checkout.email) return "skipped: no email address on this checkout";
  if (!checkout.url) return "skipped: no checkout link available";

  let info;
  try {
    info = await getShopFooterInfo(admin);
  } catch {
    info = {};
  }
  const shopInfo = {
    name: info.name || "Only Natural Gemstones",
    url: info.url || "https://onlynaturalgemstones.com",
    logoUrl: info.logoUrl || FALLBACK_LOGO_URL,
  };

  const { raw, html: htmlVars } = buildEmailVars(checkout, shopInfo);
  const html = renderAbandonedTemplate(getAbandonedCheckoutEmailTemplate(settings), htmlVars);
  const subject = renderAbandonedTemplate(getAbandonedCheckoutEmailSubject(settings), raw);
  const text =
    `Hello ${raw.customer_first_name},\n\n` +
    `You left something beautiful in your cart (${raw.item_count}, total ${raw.total}).\n` +
    `Every stone we sell is a single, natural piece, so once it is bought by someone else it is gone for good.\n\n` +
    `Complete your order: ${raw.checkout_url}\n\n` +
    `Need help? Just reply to this email.\n\n` +
    `Unsubscribe from cart reminders: ${raw.unsubscribe_url}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });
  await transporter.sendMail({
    from: `"${shopInfo.name}" <${settings.gmailUser}>`,
    to: checkout.email,
    subject,
    text,
    html,
    headers: { "List-Unsubscribe": `<${raw.unsubscribe_url}>` },
  });
  return `OK: sent to ${checkout.email}`;
}

// ---------------------------------------------------------------- the sweep

function clampDelayMinutes(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DELAY_MINUTES;
  return Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, n));
}

export function isEnabled(settings) {
  return String(settings.abandonedCheckoutEnabled || "") === "true";
}

/**
 * One pass over recent abandoned checkouts.
 *   dryRun: true  -> decide only; nothing is sent or written (works even while switched off)
 *   dryRun: false -> does nothing at all unless switched on in Settings
 */
export async function runAbandonedCheckoutSweep({ admin, shop, dryRun = false, now = new Date() }) {
  const settings = await getAppSettings(shop);
  const enabled = isEnabled(settings);
  if (!enabled && !dryRun) return { enabled: false, checked: 0, sent: 0, failed: 0, skipped: 0, items: [] };
  // Without Gmail nothing can be sent. Stop here WITHOUT writing any record, so these checkouts are
  // still picked up on the first run after Gmail is connected (instead of being logged as "handled").
  if (!dryRun && (!settings.gmailUser || !settings.gmailAppPassword)) {
    return { enabled, error: "Gmail is not connected (Settings -> Connections), so no emails were sent.", checked: 0, sent: 0, failed: 0, skipped: 0, items: [] };
  }

  const delayMinutes = clampDelayMinutes(settings.abandonedCheckoutDelayMinutes);
  const nowMs = now.getTime();
  const maxAgeSince = nowMs - MAX_AGE_DAYS * 24 * HOUR_MS;
  const enabledSinceMs = settings.abandonedCheckoutEnabledSince ? new Date(settings.abandonedCheckoutEnabledSince).getTime() : 0;
  const sinceMs = enabled && enabledSinceMs ? Math.max(maxAgeSince, enabledSinceMs) : maxAgeSince;

  let checkouts;
  try {
    checkouts = await fetchRecentCheckouts(admin, new Date(sinceMs));
  } catch (err) {
    console.error("[abandonedCheckoutEmail] could not read abandoned checkouts:", err);
    return { enabled, error: String((err && err.message) || err), checked: 0, sent: 0, failed: 0, skipped: 0, items: [], delayMinutes };
  }

  const ids = checkouts.map((c) => c.id);
  const emails = [...new Set(checkouts.map((c) => c.email).filter(Boolean))];
  const [handled, opts, recent] = await Promise.all([
    ids.length ? prisma.abandonedCheckoutEmail.findMany({ where: { checkoutId: { in: ids } }, select: { checkoutId: true } }) : [],
    emails.length ? prisma.abandonedCheckoutOptOut.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [],
    emails.length
      ? prisma.abandonedCheckoutEmail.findMany({
          where: { email: { in: emails }, status: { startsWith: "OK" }, notifiedAt: { gte: new Date(nowMs - PER_ADDRESS_COOLDOWN_HOURS * HOUR_MS) } },
          select: { email: true },
        })
      : [],
  ]);
  const ctx = {
    nowMs,
    delayMs: delayMinutes * 60 * 1000,
    sinceMs,
    handledIds: new Set(handled.map((r) => r.checkoutId)),
    optedOut: new Set(opts.map((r) => r.email)),
    recentlyEmailed: new Set(recent.map((r) => r.email)),
  };

  const out = { enabled, delayMinutes, checked: checkouts.length, sent: 0, failed: 0, skipped: 0, waiting: 0, items: [] };
  let sendsThisRun = 0;

  for (const c of checkouts) {
    const d = decideCheckout(c, ctx);
    const row = { name: c.name, email: c.email, customer: c.fullName, createdAt: c.createdAt, total: formatMoney(c.total), decision: d.action, reason: d.reason };

    if (d.action === "wait") {
      out.waiting += 1;
      out.items.push(row);
      continue;
    }

    if (d.action === "skip") {
      out.skipped += 1;
      if (d.record && !dryRun) {
        await prisma.abandonedCheckoutEmail
          .create({ data: { shop, checkoutId: c.id, checkoutName: c.name, email: c.email || null, customerName: c.fullName || null, status: "skipped: " + d.reason, checkoutCreatedAt: c.createdAt ? new Date(c.createdAt) : null } })
          .catch(() => {});
      }
      out.items.push(row);
      continue;
    }

    // action === "send"
    if (dryRun) {
      row.reason = "would send now";
      out.items.push(row);
      continue;
    }
    if (sendsThisRun >= MAX_SENDS_PER_RUN) {
      row.decision = "wait";
      row.reason = `limit of ${MAX_SENDS_PER_RUN} emails per run reached; next run`;
      out.waiting += 1;
      out.items.push(row);
      continue;
    }

    // Claim first. If another run already claimed this checkout, the unique id makes this fail and we do nothing.
    let claim;
    try {
      claim = await prisma.abandonedCheckoutEmail.create({
        data: { shop, checkoutId: c.id, checkoutName: c.name, email: c.email, customerName: c.fullName || null, status: "sending...", snapshot: c, checkoutCreatedAt: c.createdAt ? new Date(c.createdAt) : null },
      });
    } catch (err) {
      row.decision = "skip";
      row.reason = "already claimed by another run";
      out.items.push(row);
      continue;
    }

    let status;
    try {
      status = await sendAbandonedCheckoutEmail(admin, settings, c);
    } catch (err) {
      status = "threw: " + String((err && err.message) || err);
      console.error("[abandonedCheckoutEmail] send failed for", c.name, err);
    }
    await prisma.abandonedCheckoutEmail.update({ where: { id: claim.id }, data: { status, notifiedAt: new Date() } }).catch(() => {});
    sendsThisRun += 1;
    if (String(status).startsWith("OK")) {
      out.sent += 1;
      ctx.recentlyEmailed.add(c.email);
      row.reason = "sent";
    } else {
      out.failed += 1;
      row.reason = status;
    }
    row.decision = String(status).startsWith("OK") ? "sent" : "failed";
    out.items.push(row);
  }

  return out;
}

/** A believable sample cart for "Send a test email". Nothing is read from or written to any real checkout. */
export function sampleCheckout(email, shopUrl = "https://onlynaturalgemstones.com") {
  return {
    id: "sample",
    name: "#SAMPLE",
    email,
    firstName: "Test",
    fullName: "Test Customer",
    consent: true,
    url: shopUrl,
    total: { amount: "27300.00", currency: "INR" },
    items: [
      { title: "Blue Sapphire (Neelam) - 5.25 Carat", variantTitle: "", quantity: 1, imageUrl: "" },
      { title: "Gemstone Customisation", variantTitle: "Pendant / Panchdhatu / PD02", quantity: 1, imageUrl: "" },
    ],
  };
}
