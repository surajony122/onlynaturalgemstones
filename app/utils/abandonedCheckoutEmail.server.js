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
 *      marketing, has not ordered since and has not unsubscribed. There is no
 *      per-address limit: a customer who abandons five checkouts gets five emails
 *      (one per checkout), never more.
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
const HOUR_MS = 60 * 60 * 1000;
const FALLBACK_APP_URL = "https://shubh-gems-customizer-app.onrender.com";

// ---------------------------------------------------------------- template

export const ABANDONED_CHECKOUT_EMAIL_PLACEHOLDERS = [
  { token: "customer_first_name", description: "Customer's first name (\"there\" if unknown)" },
  { token: "items_html", description: "The cart items, with photo, name, variant and quantity (generated automatically)" },
  { token: "item_count", description: "Number of items in the cart" },
  { token: "totals_html", description: "Subtotal, discount and total block (generated automatically)" },
  { token: "total", description: "Cart total, e.g. ₹81,700.00" },
  { token: "checkout_url", description: "Link that takes the customer back to their saved checkout" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store web address" },
  { token: "shop_email", description: "Store support email address" },
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
    .email-button { display: block; box-sizing: border-box; width: 100%; text-align: center; background-color: #8c7a4e; color: #ffffff !important; padding: 12px 5px; font-size: 14px; font-weight: 500; line-height: 16px; border-radius: 3px; white-space: nowrap; text-decoration: none !important; }
    .secondary-button { background-color: #ffffff; color: #8c7a4e !important; border: 1px solid #8c7a4e; padding: 11px 5px; }
    .note-section { padding: 18px 28px 6px; font-size: 14px; line-height: 1.6; color: #4f5965; }
    .note-box { background-color: #fffcf3; border-left: 3px solid #8c7a4e; padding: 12px 16px; }
    .footer-section {
      padding: 14px 18px 16px;
      text-align: center;
      color: #4f5965;
      background-color: #fffcf3;
    }

    .footer-title {
      margin: 0 0 8px;
      font-size: 14px;
      line-height: 1.45;
      color: #4f5965;
    }

    .address {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.45;
      color: #333333 !important;
    }

    .address a {
      color: #333333 !important;
      text-decoration: none !important;
    }

    /* ==============================
       CONTACT INFORMATION
    ============================== */

    .contact-table {
      width: 100%;
      margin: 0 auto;
      table-layout: fixed;
    }

    .website-row {
      padding-bottom: 8px;
    }

    .contact-item {
      width: 50%;
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 13px;
      line-height: 18px;
    }

    .single-contact-item {
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 13px;
      line-height: 18px;
    }

    .contact-link {
      color: #333333 !important;
      text-decoration: none !important;
      white-space: nowrap;
    }

    .contact-icon {
      width: 18px;
      height: 18px;
      display: block;
    }
    .contact-link { color: #333333 !important; }
    @media only screen and (max-width: 520px) {
      .content-section { padding: 24px 18px 8px !important; }
      .button-cell, .note-section, .footer-section { padding-left: 18px !important; padding-right: 18px !important; }
      .email-button { font-size: 13px !important; padding: 11px 3px !important; }
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
              {{totals_html}}
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 28px 8px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="48%" valign="middle"><a class="email-button" href="{{checkout_url}}">Complete my order</a></td>
                  <td width="4%" style="width:14px;min-width:14px;font-size:1px;line-height:1px;">&nbsp;</td>
                  <td width="48%" valign="middle"><a class="email-button secondary-button" href="{{shop_url}}">Visit Our Store</a></td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="note-section">
              <div class="note-box">
                Need help choosing, or have a question about a stone? Just reply to this email and our team will get back to you.
              </div>
            </td>
          </tr>

          <tr><td><div class="divider">&nbsp;</div></td></tr>

          <tr>
            <td class="footer-section">

              <p class="footer-title">
                Thanks for choosing {{shop_name}} from the House of Shubh Gems.
              </p>

              <p class="address">

                <a href="https://maps.app.goo.gl/vffRkrDyMiM9q895A">
                  L-75-76, Lajpat Nagar 2, New Delhi - Delhi - 110024, India
                </a>

              </p>

              <!-- WEBSITE -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>

                  <td
                    class="single-contact-item website-row"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/website.png?v=1788870868"
                            alt="Website"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >

                        </td>

                        <td valign="middle">

                          <a
                            href="{{shop_url}}"
                            class="contact-link"
                          >
                            onlynaturalgemstones.com
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                </tr>

              </table>

              <!-- WHATSAPP AND PHONE -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>

                  <!-- WHATSAPP -->

                  <td
                    class="contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >

                          <a href="https://wa.me/919310400152">

                            <img
                              src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358"
                              alt="WhatsApp"
                              width="18"
                              height="18"
                              class="contact-icon"
                            >

                          </a>

                        </td>

                        <td valign="middle">

                          <a
                            href="https://wa.me/919310400152"
                            class="contact-link"
                          >
                            +91-9310-400-152
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                  <!-- PHONE -->

                  <td
                    class="contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346"
                            alt="Phone"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >

                        </td>

                        <td valign="middle">

                          <a
                            href="tel:+918010555111"
                            class="contact-link"
                          >
                            +91-8010-555-111
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                </tr>

              </table>

              <!-- EMAIL -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>

                  <td
                    class="single-contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >

                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/email_icon_24px.png?v=1790236665" alt="Email" width="18" class="contact-icon">

                        </td>

                        <td valign="middle">

                          <a
                            href="mailto:{{shop_email}}"
                            class="contact-link"
                          >
                            {{shop_email}}
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                </tr>

              </table>

            </td>
          </tr>

          <tr>
            <td style="padding:10px 28px 14px; text-align:center; font-size:11px; line-height:1.6; color:#7b8590; background-color:#fffcf3; border-top:1px solid #ece6d9;">
              You are receiving this email because you left items in your cart at {{shop_name}}.<br>
              <a href="{{unsubscribe_url}}" style="color:#7b8590;">Unsubscribe from cart reminders</a>
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

const CHECKOUTS_QUERY_TEMPLATE = `#graphql
  query AbandonedCheckoutsForReminder($first: Int!, $query: String) {
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
            __PRICE__
          }
        }
      }
    }
  }`;

const CHECKOUTS_QUERY = CHECKOUTS_QUERY_TEMPLATE.replace("__PRICE__", "originalTotalPriceSet { shopMoney { amount currencyCode } } variant { id }");
// If Shopify ever rejects the line-price field, the list still loads (just without per-line prices).
const CHECKOUTS_QUERY_NO_PRICES = CHECKOUTS_QUERY_TEMPLATE.replace("__PRICE__", "");

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
      price: li.originalTotalPriceSet && li.originalTotalPriceSet.shopMoney ? Number(li.originalTotalPriceSet.shopMoney.amount) : null,
      variantId: li.variant && li.variant.id ? String(li.variant.id).split("/").pop() : "",
      linkedId: String(la["_Linked Gemstone"] || la["Linked Gemstone"] || "").trim(),
      isCustomisation: /customi[sz]ation/i.test(li.title || "") || la["_Linked Gemstone"] != null || la["Linked Gemstone"] != null,
      props: Object.keys(la)
        .filter((k) => k[0] !== "_" && !/^(Linked Gemstone|Lab Certification|GJI Certification|Custom Design Image)$/.test(k) && String(la[k] || "").trim())
        .map((k) => String(la[k]).trim()),
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

async function runCheckoutsQuery(admin, first, query) {
  let res = await admin.graphql(CHECKOUTS_QUERY, { variables: { first, query } });
  let json = await res.json();
  if (json.errors && json.errors.length && /originalTotalPriceSet|variant/i.test(JSON.stringify(json.errors))) {
    res = await admin.graphql(CHECKOUTS_QUERY_NO_PRICES, { variables: { first, query } });
    json = await res.json();
  }
  if (json.errors && json.errors.length) {
    throw new Error("Shopify said: " + json.errors.map((e) => e.message).join("; "));
  }
  return ((json.data && json.data.abandonedCheckouts && json.data.abandonedCheckouts.nodes) || []).map(normaliseCheckout);
}

/**
 * Recent abandoned checkouts, newest first. Shopify's search filter is picky about date
 * syntax, and a filter it does not understand quietly returns NOTHING. So: try a plain
 * date filter, and if that finds nothing ask for the newest checkouts with no filter at all,
 * then apply the exact cut-off here. A search quirk can then never hide every checkout.
 */
export async function fetchRecentCheckouts(admin, sinceDate, limit = FETCH_LIMIT) {
  const sinceMs = sinceDate.getTime();
  let list = await runCheckoutsQuery(admin, limit, `created_at:>=${sinceDate.toISOString().slice(0, 10)}`);
  if (!list.length) list = await runCheckoutsQuery(admin, limit, null);
  return list.filter((c) => !c.createdAt || new Date(c.createdAt).getTime() >= sinceMs);
}

// ---------------------------------------------------------------- the decision (pure, no I/O)

/**
 * Decides what to do with one checkout.
 *   action "send"  -> email it now
 *   action "wait"  -> not due yet, look again next run
 *   action "skip"  -> never email it; `record` says whether to write that down
 */
export function decideCheckout(c, ctx) {
  const { nowMs, delayMs, sinceMs, handledIds, optedOut } = ctx;
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

const SUB = "font-size:12px;line-height:1.5;color:#7b8590;";

function moneyOf(n, currency) {
  return formatMoney({ amount: n, currency });
}

/**
 * The cart as the same bundle cards the order confirmation uses: a gemstone and its
 * "Gemstone Customisation" charge share ONE bordered card (image/title/price, then the
 * customisation label + price, then its Type/Metal/Design line, then a combined Total).
 * A customisation line pairs with the gemstone just before it in the cart; one with no
 * gemstone before it still gets its own card so nothing is hidden. A customisation line
 * never shows a quantity (the old pricing trick used a huge quantity of a Rs 1 item).
 */
export function buildItemsHtml(items, currency = "INR") {
  // One card per gemstone, in cart order. A customisation line can sit before OR after its gemstone
  // in the cart, so pair by the hidden "_Linked Gemstone" value (= the gemstone's variant id) when
  // both are known, then pair whatever is left in cart order. A customisation that finds no
  // gemstone still gets its own card.
  const gems = items.filter((it) => !it.isCustomisation).map((gem) => ({ gem, cust: null }));
  const custs = items.filter((it) => it.isCustomisation);
  const loose = [];
  for (const c of custs) {
    const g = c.linkedId ? gems.find((x) => !x.cust && x.gem.variantId && x.gem.variantId === c.linkedId) : null;
    if (g) g.cust = c;
    else loose.push(c);
  }
  const leftover = [];
  for (const c of loose) {
    const g = gems.find((x) => !x.cust);
    if (g) g.cust = c;
    else leftover.push({ gem: null, cust: c });
  }
  const groups = gems.concat(leftover);
  const money = (n) => (n != null && !Number.isNaN(n) ? esc(moneyOf(n, currency)) : "");
  const gold = "font-size:13px;color:#8C7A4E;";
  const small = "font-size:10px;line-height:1.5;color:#4f5965;";
  const priceTd = (v, pad) => `<td width="90" align="right" valign="top" style="width:90px;padding:${pad};font-size:12px;color:#4f5965;white-space:nowrap;">${v}</td>`;
  const propsOf = (it) => (it.props || []).map(esc).join(" &middot; ");

  const cards = groups.map(({ gem, cust }) => {
    let rows = "";
    if (gem) {
      const img = gem.imageUrl
        ? `<img src="${esc(gem.imageUrl)}" alt="${esc(gem.title)}" width="42" height="42" style="width:42px;height:42px;object-fit:cover;border:0;display:block;">`
        : "";
      const variant = gem.variantTitle && gem.variantTitle !== "Default Title" ? `<br>${esc(gem.variantTitle)}` : "";
      const own = propsOf(gem);
      rows +=
        `<tr><td width="55" valign="top" style="width:55px;padding:8px 8px 0 14px;">${img}</td>` +
        `<td valign="top" style="padding:9px 8px 4px;"><div style="margin:0 0 3px;${gold}">${esc(gem.title)}</div>` +
        `<div style="${small}">Qty: ${esc(gem.quantity)}${variant}${own ? "<br>" + own : ""}</div></td>` +
        priceTd(money(gem.price), "14px 14px 4px 0") +
        `</tr>`;
    }
    if (cust) {
      const props = propsOf(cust);
      rows +=
        `<tr><td width="55" style="width:55px;padding:2px 8px 0 14px;"></td>` +
        `<td valign="top" style="padding:2px 8px 0;"><div style="${gold}">Gemstone Customisation</div></td>` +
        priceTd(money(cust.price), "2px 14px 0 0") +
        `</tr>`;
      if (props) {
        rows +=
          `<tr><td width="55" style="width:55px;padding:2px 8px 0 14px;"></td>` +
          `<td colspan="2" valign="top" style="padding:2px 14px 8px 8px;"><div style="font-size:10px;line-height:1.6;color:#4f5965;">${props}</div></td></tr>`;
      }
      if (gem && gem.price != null && cust.price != null) {
        const tb = "border-top:1px solid #ece6d9;";
        rows +=
          `<tr><td style="padding:5px 0 8px;${tb}"></td>` +
          `<td valign="top" style="padding:5px 8px 8px;text-align:left;font-size:12px;font-weight:bold;color:#3d4652;${tb}">Total</td>` +
          `<td align="right" valign="top" style="padding:5px 14px 8px 0;font-size:12px;font-weight:bold;color:#3d4652;white-space:nowrap;${tb}">${money(gem.price + cust.price)}</td></tr>`;
      }
    }
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2dccf;border-radius:4px;margin-bottom:6px;">${rows}</table>`;
  });
  return cards.join("");
}

/** Subtotal / Discount / Total block, same look as the order confirmation's totals. */
export function buildTotalsHtml(checkout) {
  const currency = (checkout.total && checkout.total.currency) || "INR";
  const total = checkout.total && checkout.total.amount != null ? Number(checkout.total.amount) : null;
  const priced = checkout.items.filter((it) => it.price != null && !Number.isNaN(it.price));
  const subtotal = priced.length && priced.length === checkout.items.length ? priced.reduce((n, it) => n + it.price, 0) : null;
  const row = (label, value, bold) => {
    const st = bold ? "font-size:13px;font-weight:bold;color:#3d4652;" : "font-size:12px;color:#4f5965;";
    return `<tr><td align="right" style="padding:3px 8px;${st}">${label}</td><td width="100" align="right" style="padding:3px 0;${st}white-space:nowrap;">${esc(value)}</td></tr>`;
  };
  let rows = "";
  if (subtotal != null) rows += row("Subtotal", moneyOf(subtotal, currency));
  if (subtotal != null && total != null && subtotal - total > 0.5) rows += row("Discount", "-" + moneyOf(subtotal - total, currency));
  if (total != null) rows += row("Total", moneyOf(total, currency), true);
  return rows ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">${rows}</table>` : "";
}

export function buildEmailVars(checkout, shopInfo) {
  const first = (checkout.firstName || "").trim() || "there";
  const count = checkout.items.filter((it) => !it.isCustomisation).reduce((n, it) => n + (Number(it.quantity) || 1), 0) || 1;
  const currency = (checkout.total && checkout.total.currency) || "INR";
  const raw = {
    customer_first_name: first,
    item_count: `${count} item${count === 1 ? "" : "s"}`,
    total: formatMoney(checkout.total),
    checkout_url: checkout.url,
    shop_name: shopInfo.name,
    shop_url: shopInfo.url,
    shop_email: shopInfo.email || "",
    shop_logo_url: shopInfo.logoUrl,
    unsubscribe_url: buildUnsubscribeUrl(checkout.email),
  };
  // HTML context: every value escaped, except the generated blocks, which are already safe markup.
  const html = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, esc(v)]));
  html.items_html = buildItemsHtml(checkout.items, currency);
  html.totals_html = buildTotalsHtml(checkout);
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
    email: info.email || "info@onlynaturalgemstones.com",
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
  const [handled, opts] = await Promise.all([
    ids.length ? prisma.abandonedCheckoutEmail.findMany({ where: { checkoutId: { in: ids } }, select: { checkoutId: true } }) : [],
    emails.length ? prisma.abandonedCheckoutOptOut.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [],
  ]);
  const ctx = {
    nowMs,
    delayMs: delayMinutes * 60 * 1000,
    sinceMs,
    handledIds: new Set(handled.map((r) => r.checkoutId)),
    optedOut: new Set(opts.map((r) => r.email)),
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
      { title: "Blue Sapphire (Neelam) - 5.25 Carat", variantTitle: "", quantity: 1, imageUrl: "", price: 24500, isCustomisation: false, props: [] },
      { title: "Gemstone Customisation", variantTitle: "", quantity: 1, imageUrl: "", price: 2800, isCustomisation: true, props: ["Pendant", "Panchdhatu", "PD02"] },
    ],
  };
}

// ---------------------------------------------------------------- the "Abandoned Checkouts" page

/** Reads a saved log status ("OK: ...", "FAILED: ...", "skipped: ...") into a simple kind. */
export function classifyLogStatus(status) {
  const t = String(status || "");
  if (/^OK/i.test(t)) return "sent";
  if (/^(FAILED|threw)/i.test(t)) return "failed";
  if (/^sending/i.test(t)) return "sending";
  if (/^(skipped|dismissed)/i.test(t)) return "skipped";
  return "unknown";
}

const cleanStatusText = (t) => String(t || "").replace(/^(skipped|dismissed by staff|FAILED|threw)\s*:?\s*/i, "").replace(/\s+/g, " ").trim();

/**
 * Everything the Abandoned Checkouts page needs: Shopify's own recent abandoned
 * checkouts, each joined to what this app did about it (sent / failed / skipped
 * and why), or, if nothing has been done yet, what the next sweep WILL do and why.
 * Read-only: nothing is sent or saved here.
 */
export async function getAbandonedCheckoutView({ admin, shop, days = 7, now = new Date() }) {
  const settings = await getAppSettings(shop);
  const enabled = isEnabled(settings);
  const delayMinutes = clampDelayMinutes(settings.abandonedCheckoutDelayMinutes);
  const gmailReady = !!(settings.gmailUser && settings.gmailAppPassword);
  const nowMs = now.getTime();
  const windowDays = Math.min(30, Math.max(1, parseInt(days, 10) || 7));
  const enabledSince = settings.abandonedCheckoutEnabledSince || null;
  const enabledSinceMs = enabledSince ? new Date(enabledSince).getTime() : 0;
  const maxAgeSince = nowMs - MAX_AGE_DAYS * 24 * HOUR_MS;
  const sinceMs = enabled && enabledSinceMs ? Math.max(maxAgeSince, enabledSinceMs) : maxAgeSince;
  const base = { enabled, gmailReady, delayMinutes, enabledSince, windowDays, rows: [], counts: {} };

  let checkouts;
  try {
    checkouts = await fetchRecentCheckouts(admin, new Date(nowMs - windowDays * 24 * HOUR_MS), 100);
  } catch (err) {
    console.error("[abandonedCheckoutEmail] page could not read abandoned checkouts:", err);
    return { ...base, error: String((err && err.message) || err) };
  }

  const ids = checkouts.map((c) => c.id);
  const emails = [...new Set(checkouts.map((c) => c.email).filter(Boolean))];
  const [logs, opts] = await Promise.all([
    ids.length ? prisma.abandonedCheckoutEmail.findMany({ where: { checkoutId: { in: ids } } }) : [],
    emails.length ? prisma.abandonedCheckoutOptOut.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [],
  ]);
  const logById = new Map(logs.map((l) => [l.checkoutId, l]));
  const optedOut = new Set(opts.map((o) => o.email));
  const ctx = { nowMs, delayMs: delayMinutes * 60 * 1000, sinceMs, handledIds: new Set(), optedOut };

  const counts = { total: 0, sent: 0, failed: 0, "will-send": 0, off: 0, waiting: 0, skipped: 0, recovered: 0, sending: 0 };
  const rows = checkouts.map((c) => {
    const log = logById.get(c.id);
    let state;
    let reason = "";
    if (c.completedAt) {
      state = "recovered";
      reason = "The customer completed this checkout.";
    } else if (log && classifyLogStatus(log.status) === "sent") {
      state = "sent";
      reason = cleanStatusText(log.status) || "Email sent";
    } else if (log && classifyLogStatus(log.status) === "failed") {
      state = "failed";
      reason = cleanStatusText(log.status);
    } else if (log && classifyLogStatus(log.status) === "sending") {
      state = "sending";
      reason = "Sending now.";
    } else if (log) {
      state = "skipped";
      reason = cleanStatusText(log.status);
    } else {
      const d = decideCheckout(c, ctx);
      if (d.action === "send") {
        state = enabled ? "will-send" : "off";
        reason = enabled ? "Due. It goes out on the next check (within about 5 minutes)." : "Would be emailed, but abandoned checkout emails are switched off.";
      } else if (d.action === "wait") {
        state = "waiting";
        reason = d.reason;
      } else {
        state = "skipped";
        reason = d.reason;
      }
    }
    counts.total += 1;
    counts[state] = (counts[state] || 0) + 1;

    const alreadySent = state === "sent";
    const blocked =
      c.completedAt || !c.items.length || !c.email || !c.consent || optedOut.has(c.email) || (c.lastOrderAt && new Date(c.lastOrderAt).getTime() >= new Date(c.createdAt).getTime());
    return {
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      customer: c.fullName,
      email: c.email,
      consent: c.consent,
      items: c.items.map((i) => ({ title: i.title, quantity: i.quantity })),
      total: formatMoney(c.total),
      state,
      reason,
      sentAt: log && alreadySent ? new Date(log.notifiedAt).toISOString() : null,
      logId: log ? log.id : null,
      canSendNow: !alreadySent && !blocked && gmailReady,
      canResend: alreadySent && !blocked && gmailReady,
      canRetry: state === "failed" && !!(log && log.snapshot),
      canSkip: ["will-send", "off", "waiting", "failed"].includes(state),
    };
  });

  return { ...base, rows, counts };
}

/**
 * Staff pressed "Send now" on one checkout: sends it immediately, ignoring the idle
 * delay and the once-a-day limit, but still honouring the rules that protect the
 * customer (marketing consent, not unsubscribed, hasn't ordered since, not completed).
 */
export async function sendCheckoutNow({ admin, shop, checkoutId, resend = false }) {
  const settings = await getAppSettings(shop);
  if (!settings.gmailUser || !settings.gmailAppPassword) return { ok: false, status: "error: Gmail is not connected (Settings -> Connections)." };

  const existing = await prisma.abandonedCheckoutEmail.findUnique({ where: { checkoutId } });
  if (!resend && existing && classifyLogStatus(existing.status) === "sent") return { ok: false, status: "skipped: an email was already sent for this checkout." };

  let checkouts;
  try {
    checkouts = await fetchRecentCheckouts(admin, new Date(Date.now() - 30 * 24 * HOUR_MS), 100);
  } catch (err) {
    return { ok: false, status: "error: " + String((err && err.message) || err) };
  }
  const c = checkouts.find((x) => x.id === checkoutId);
  if (!c) return { ok: false, status: "error: Shopify no longer lists this checkout (it may be older than 30 days)." };
  if (c.completedAt) return { ok: false, status: "skipped: the customer completed this checkout." };
  if (!c.items.length) return { ok: false, status: "skipped: no items in the cart." };
  if (!c.email) return { ok: false, status: "skipped: no email address on this checkout." };
  if (!c.consent) return { ok: false, status: "skipped: the customer did not agree to email marketing." };
  if (await prisma.abandonedCheckoutOptOut.findUnique({ where: { email: c.email } })) return { ok: false, status: "skipped: this address unsubscribed from cart reminders." };
  if (c.lastOrderAt && new Date(c.lastOrderAt).getTime() >= new Date(c.createdAt).getTime()) return { ok: false, status: "skipped: the customer placed an order after this checkout." };

  const data = { shop, checkoutId: c.id, checkoutName: c.name, email: c.email, customerName: c.fullName || null, status: "sending...", snapshot: c, checkoutCreatedAt: c.createdAt ? new Date(c.createdAt) : null, notifiedAt: new Date() };
  const row = existing
    ? await prisma.abandonedCheckoutEmail.update({ where: { id: existing.id }, data })
    : await prisma.abandonedCheckoutEmail.create({ data });

  let status;
  try {
    status = await sendAbandonedCheckoutEmail(admin, settings, c);
  } catch (err) {
    status = "threw: " + String((err && err.message) || err);
  }
  await prisma.abandonedCheckoutEmail.update({ where: { id: row.id }, data: { status, notifiedAt: new Date() } });
  return { ok: classifyLogStatus(status) === "sent", status };
}

/** "Don't email this one": recorded as skipped, so the sweep never sends it. */
export async function markDoNotEmail({ shop, checkoutId, checkoutName, email, customerName }) {
  const status = "skipped: marked do-not-email by staff";
  const existing = await prisma.abandonedCheckoutEmail.findUnique({ where: { checkoutId } });
  if (existing) {
    if (classifyLogStatus(existing.status) === "sent") return { ok: false, status: "An email was already sent for this checkout." };
    await prisma.abandonedCheckoutEmail.update({ where: { id: existing.id }, data: { status, notifiedAt: new Date() } });
  } else {
    await prisma.abandonedCheckoutEmail.create({ data: { shop, checkoutId, checkoutName: checkoutName || null, email: email || null, customerName: customerName || null, status } });
  }
  return { ok: true, status };
}
