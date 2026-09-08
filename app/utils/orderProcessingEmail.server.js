/**
 * Customer-facing "your order is being processed" email -- the email
 * counterpart to the WhatsApp order-processing notification. Shopify's
 * own native notification settings only cover Order confirmation,
 * Shipping confirmation, Delivered, and Order cancelled -- there is no
 * built-in "processing/approved" trigger to hook a Liquid template
 * into, so this app sends it directly instead, reusing the exact same
 * trigger detection already built and hardened for the WhatsApp send
 * (tag OR order-timeline "in progress" event, see
 * orderProcessingTrigger.server.js) and the merchant's already-connected
 * Gmail (Settings page) rather than inventing a new email channel.
 *
 * The HTML is a real, editable TEMPLATE, not generated markup -- per
 * explicit request, a merchant can view/edit its raw HTML and preview it
 * from the Settings page (see app.settings.jsx's "Order processing
 * email template" section) instead of only ever being the hardcoded
 * default below. AppSettings.orderProcessingEmailTemplate (null =
 * "use the default") wins when set; getOrderProcessingEmailTemplate()
 * is the ONE place that resolution happens, so the Settings page's own
 * preview and the actual send path can never quietly drift apart by
 * each keeping their own copy of the fallback.
 *
 * Design matches the store's own native Shopify notification templates
 * (Order confirmation / cancelled / etc.) rather than the earlier
 * bundle-card layout this used to have -- per explicit request, so
 * every order-lifecycle email (native + this app-sent one) shares one
 * visual identity instead of the "processing" email looking like a
 * different product entirely.
 */
import nodemailer from "nodemailer";
import { getShopFooterInfo, esc } from "./astroAdvice.server";

// Documented once, here, so the Settings page's "available
// placeholders" help text and the actual substitution logic below can
// never drift apart from each other.
export const ORDER_PROCESSING_EMAIL_PLACEHOLDERS = [
  { token: "customer_first_name", description: "Customer's name (falls back to \"there\" if unknown)" },
  { token: "order_number", description: "Order number, e.g. #1000031314" },
  { token: "order_status_url", description: "Link to the customer's own order status page" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store URL" },
  { token: "shop_email", description: "Store support email address" },
  { token: "shop_logo_url", description: "Store logo image URL (a sensible fallback logo is used if the store has none set)" },
];

// The store's fixed contact details in the footer (address, WhatsApp,
// phone, icon images) are baked in as literal HTML rather than
// templated placeholders -- they're specific to this one store, not
// something that varies per-order the way the fields above do. A
// merchant can still change any of it by editing the template HTML
// directly once it's customized from the Settings page.
function getDefaultOrderProcessingEmailTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Your order is being processed</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width">
  <style type="text/css">
    body { margin: 0; padding: 0; width: 100%; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; color: #4f5965; }
    table { border-spacing: 0; border-collapse: collapse; }
    img { border: 0; display: block; }
    .email-wrapper { width: 100%; background-color: #ffffff; }
    .email-container { width: 100%; max-width: 500px; margin: 0 auto; background-color: #ffffff; }
    .logo-section { padding: 35px 20px 30px; text-align: center; }
    .logo-section img { max-width: 200px; width: auto; height: auto; margin: 0 auto; }
    .logo-text { margin: 0; font-size: 30px; font-weight: normal; color: #a76642; }
    .divider-cell { padding-left: 18px; padding-right: 18px; }
    .divider { height: 1px; background-color: #b9b9b9; width: 100%; font-size: 1px; line-height: 1px; }
    .content-section { padding: 30px 20px 20px; font-size: 17px; line-height: 1.6; color: #4f5965; }
    .content-inner { width: 100%; max-width: 620px; margin: 0 auto; }
    .content-section p { margin-top: 0; margin-bottom: 18px; }
    .order-number { font-weight: bold; color: #3d4652; }
    .button-container { margin-top: 8px; margin-bottom: 10px; }
    .email-button { display: inline-block; background-color: #8C7A4E; color: #ffffff !important; text-decoration: none !important; padding: 10px 20px; font-size: 15px; font-weight: 400; border-radius: 3px; margin-right: 10px; margin-bottom: 5px; }
    .secondary-button { background-color: #ffffff; color: #8C7A4E !important; border: 1px solid #8C7A4E; }
    .footer-section { padding: 15px 18px 20px; text-align: center; color: #4f5965; }
    .footer-title { margin: 0 0 6px; font-size: 16px; line-height: 1.5; color: #4f5965; }
    .address { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #000000 !important; text-decoration: none !important; font-weight: normal; }
    .address, .address span, .address a, .address a:link, .address a:visited { color: #000000 !important; text-decoration: none !important; border-bottom: none !important; }
    .contact-table { width: 100%; max-width: 600px; margin: 0 auto; table-layout: fixed; }
    .contact-item { width: 50%; padding: 6px 5px; text-align: center; vertical-align: middle; font-size: 14px; }
    .single-contact-item { padding: 6px 5px; text-align: center; vertical-align: middle; font-size: 14px; }
    .contact-link { color: #000 !important; text-decoration: none !important; white-space: nowrap; }
    .contact-icon { font-size: 17px; vertical-align: middle; color: #000; }
    @media only screen and (max-width: 600px) {
      .logo-section { padding-top: 25px; padding-bottom: 25px; }
      .logo-section img { max-width: 200px; }
      .content-section { padding: 25px 20px 15px; font-size: 16px; }
      .content-inner { max-width: 100%; }
      .contact-item, .single-contact-item { font-size: 11px; padding: 6px 2px; }
      .email-button { padding: 11px 16px; font-size: 14px; }
    }
  </style>
</head>
<body>
  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table class="email-container" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td class="logo-section">
              <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="200">
            </td>
          </tr>

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td class="content-section">
              <div class="content-inner">
                <p>Hello {{customer_first_name}},</p>
                <p>
                  Your order number
                  <span class="order-number">{{order_number}}</span>
                  has been updated to: <strong>Order under Processing</strong>
                </p>
                <p>Once your order is shipped, We will send an email with details to track your order.</p>
                <p>For more queries, Please feel free to contact us.</p>

                <div class="button-container">
                  <a href="{{order_status_url}}" class="email-button">View Your Order</a>
                  <a href="{{shop_url}}" class="email-button secondary-button">Visit Our Store</a>
                </div>

                <p style="margin-top: 0; margin-bottom: 0;">Best Wishes &amp; Regards!</p>
              </div>
            </td>
          </tr>

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td class="footer-section">
              <p class="footer-title">Thanks for choosing {{shop_name}} from the House of ONG.</p>

              <p class="address">
                <a href="https://maps.app.goo.gl/vffRkrDyMiM9q895A">
                  L-75-76, Lajpat Nagar 2, New Delhi - Delhi - 110024, India
                </a>
              </p>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="single-contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;"><span class="contact-icon">&#9678;</span></td>
                        <td valign="middle"><a href="{{shop_url}}" class="contact-link">onlynaturalgemstones.com</a></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <a href="https://wa.me/919310400152">
                            <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358" alt="WhatsApp" width="18" height="18" style="display:block; width:18px; height:18px; border:0;">
                          </a>
                        </td>
                        <td valign="middle"><a href="https://wa.me/919310400152" class="contact-link">+91-9310-400-152</a></td>
                      </tr>
                    </table>
                  </td>
                  <td class="contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346" alt="Call" width="18" height="18" style="display:block; width:18px; height:18px; border:0;">
                        </td>
                        <td valign="middle"><a href="tel:+918010555111" class="contact-link">+91-8010-555-111</a></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="single-contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Email.png?v=1788596216" alt="Email" width="18" height="18" style="display:block; width:auto; height:18px; border:0;">
                        </td>
                        <td valign="middle"><a href="mailto:{{shop_email}}" class="contact-link">{{shop_email}}</a></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Resolves which template HTML actually gets sent -- a saved
 * AppSettings.orderProcessingEmailTemplate wins, the built-in default
 * above otherwise. The ONE place this decision is made, so the
 * Settings page's preview and the real send path never see different
 * answers. */
export function getOrderProcessingEmailTemplate(settings) {
  return (settings && settings.orderProcessingEmailTemplate) || getDefaultOrderProcessingEmailTemplate();
}

/** Plain {{token}} substitution -- deliberately not a templating
 * engine (no conditionals/loops): every value this template needs is
 * always available by the time this runs (getShopFooterInfo always
 * returns a real logoUrl, for instance), so there's nothing that
 * actually needs branching, and keeping it to simple string
 * replacement means a merchant editing the HTML on the Settings page
 * can't break the send path with a syntax error the way a real
 * templating language could. Tolerates both {{token}} and {{ token }}
 * (with spaces), since someone hand-editing the HTML is likely to type
 * it either way. */
export function renderOrderProcessingEmailTemplate(templateHtml, vars) {
  let html = templateHtml;
  for (const [key, value] of Object.entries(vars)) {
    const safe = value != null ? String(value) : "";
    html = html.split(`{{${key}}}`).join(safe).split(`{{ ${key} }}`).join(safe);
  }
  return html;
}

/**
 * @param {object} admin - authenticated Admin GraphQL client (for the
 *   shop footer info lookup)
 * @param {object} settings - getAppSettings(shop) result
 * @param {object} payload - the raw orders/updated REST webhook payload
 * @returns {Promise<string>} same "OK: .../skipped: ..." status-string
 *   shape used by every other send* helper in this app
 */
export async function sendOrderProcessingEmail(admin, settings, payload) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail not configured (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }

  const email = payload?.email || payload?.customer?.email || payload?.contact_email || null;
  if (!email) {
    return "skipped: no email address on this order";
  }

  const orderNumber = payload?.name || `#${payload?.order_number || payload?.id}`;
  // Same fallback order as the reference template's own
  // `customer.first_name | default: customer.name` -- some checkouts
  // (COD orders on this store, seen repeatedly on real test orders)
  // only ever populate one combined name field, not separate first/last.
  const firstName = payload?.customer?.first_name || payload?.customer?.name || (payload?.shipping_address?.name || "").split(" ")[0] || "there";

  const shopInfo = await getShopFooterInfo(admin);
  const orderStatusUrl = payload?.order_status_url || shopInfo.url;

  const template = getOrderProcessingEmailTemplate(settings);
  const html = renderOrderProcessingEmailTemplate(template, {
    customer_first_name: esc(firstName),
    order_number: esc(orderNumber),
    order_status_url: esc(orderStatusUrl),
    shop_name: esc(shopInfo.name),
    shop_url: esc(shopInfo.url),
    shop_email: esc(shopInfo.email),
    shop_logo_url: esc(shopInfo.logoUrl),
  });

  const text =
    `Hello ${firstName},\n\n` +
    `Your order ${orderNumber} has been updated to: Order under Processing\n\n` +
    `Once your order is shipped, We will send an email with details to track your order.\n\n` +
    `For more queries, Please feel free to contact us.`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    // Same bounded timeouts as every other Gmail send in this app
    // (astroAdvice.server.js) -- an unbounded hang here would otherwise
    // be capable of stalling indefinitely.
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  await transporter.sendMail({
    from: `"${shopInfo.name}" <${settings.gmailUser}>`,
    to: email,
    subject: `Your Order ${orderNumber} Is Being Processed`,
    text,
    html,
  });

  return `OK: sent to ${email}`;
}
