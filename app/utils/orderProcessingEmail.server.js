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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <style type="text/css">

    body {
      margin: 0;
      padding: 0;
      width: 100%;
      background-color: #f3f2ef;
      font-family: Arial, Helvetica, sans-serif;
      color: #4f5965;
    }

    table {
      border-spacing: 0;
      border-collapse: collapse;
    }

    img {
      border: 0;
      display: block;
    }

    a {
      text-decoration: none;
    }

    /* ==============================
       PAGE
    ============================== */

    .email-wrapper {
      width: 100%;
      background-color: #f3f2ef;
    }

    .page-padding {
      padding: 32px 0;
    }

    /* ==============================
       EMAIL CONTAINER
    ============================== */

    .email-container {
      width: 500px;
      max-width: 500px;
      background-color: #ffffff;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
    }

    /* ==============================
       HEADER
    ============================== */

    .logo-section {
      padding: 28px 20px 25px;
      text-align: center;
      background-color: #fffcf3;
      border-top: 5px solid #8c7a4e;
    }

    .logo-section img {
      max-width: 100px;
      width: auto;
      height: auto;
      margin: 0 auto;
    }

    .logo-text {
      margin: 0;
      font-size: 30px;
      font-weight: normal;
      color: #a76642;
    }

    /* ==============================
       DIVIDER
    ============================== */

    .divider-cell {
      padding-left: 0;
      padding-right: 0;
    }

    .divider {
      height: 1px;
      background-color: #d5d0c8;
      width: 100%;
      font-size: 1px;
      line-height: 1px;
    }

    /* ==============================
       MAIN CONTENT
    ============================== */

    .content-section {
      padding: 30px 28px 25px;
      font-size: 15px;
      line-height: 1.6;
      color: #4f5965;
      background-color: #ffffff;
    }

    .content-inner {
      width: 100%;
      margin: 0 auto;
    }

    .content-section p {
      margin-top: 0;
      margin-bottom: 18px;
    }

    .order-number {
      font-weight: bold;
      color: #3d4652;
    }

    /* ==============================
       BUTTONS
    ============================== */

    .button-table {
      width: 100%;
      margin-top: 20px;
      margin-bottom: 10px;
    }

    .button-cell {
      width: 50%;
      vertical-align: middle;
    }

    .button-gap {
      width: 8px;
      min-width: 8px;
      font-size: 1px;
      line-height: 1px;
    }

    .email-button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      background-color: #8c7a4e;
      color: #ffffff !important;
      padding: 11px 5px;
      font-size: 14px;
      font-weight: 500;
      line-height: 16px;
      border-radius: 3px;
      white-space: nowrap;
      text-decoration: none !important;
    }

    .secondary-button {
      background-color: #ffffff;
      color: #8c7a4e !important;
      border: 1px solid #8c7a4e;
      padding: 10px 5px;
    }

    /* ==============================
       FOOTER
    ============================== */

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

    /* ==============================
       MOBILE
    ============================== */

    @media only screen and (max-width: 600px) {

      .page-padding {
        padding: 0 !important;
      }

      .email-container {
        width: 100% !important;
        max-width: 100% !important;
        border-radius: 0 !important;
      }

      .logo-section {
        padding: 22px 15px !important;
      }

      .logo-section img {
        max-width: 100px !important;
      }

      .content-section {
        padding: 24px 20px 18px !important;
        font-size: 16px !important;
      }

      /* BUTTONS STAY IN ONE ROW */

      .button-table {
        width: 100% !important;
        margin-top: 18px !important;
        margin-bottom: 10px !important;
      }

      .button-gap {
        width: 8px !important;
        min-width: 8px !important;
      }

      .email-button {
        font-size: 13px !important;
        line-height: 16px !important;
        padding: 10px 3px !important;
      }

      .secondary-button {
        padding: 9px 3px !important;
      }

      /* COMPACT FOOTER */

      .footer-section {
        padding: 12px 12px 14px !important;
      }

      .footer-title {
        font-size: 14px !important;
        line-height: 1.4 !important;
        margin-bottom: 7px !important;
      }

      .address {
        font-size: 13px !important;
        line-height: 1.4 !important;
        margin-bottom: 8px !important;
      }

      .website-row {
        padding-bottom: 6px !important;
      }

      .contact-item,
      .single-contact-item {
        padding: 3px 1px !important;
        font-size: 13px !important;
      }

      .contact-link {
        white-space: nowrap !important;
      }

    }

  </style>
</head>

<body>

  <table
    class="email-wrapper"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
  >

    <tr>

      <td class="page-padding" align="center">

        <table
          class="email-container"
          width="500"
          cellpadding="0"
          cellspacing="0"
          border="0"
        >

          <!-- HEADER -->

          <tr>
            <td class="logo-section">

              <img
                src="{{shop_logo_url}}"
                alt="{{shop_name}}"
                width="100"
              >

            </td>
          </tr>

          <!-- DIVIDER -->

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <!-- MAIN CONTENT -->

          <tr>
            <td class="content-section">

              <div class="content-inner">

                <p>Hello {{customer_first_name}},</p>

                <p>
                  Your order number
                  <span class="order-number">{{order_number}}</span>
                  has been updated to:
                  <strong>Order under Processing</strong>
                </p>

                <p>
                  You will receive tracking details once your order is shipped from our end.

                </p>

                <p>
                  For more queries, Please feel free to contact us.
                </p>

                <!-- BUTTONS -->

                <table
                  class="button-table"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                >

                  <tr>

                    <!-- VIEW ORDER -->

                    <td
                      class="button-cell"
                      width="50%"
                    >

                      <a
                        href="{{order_status_url}}"
                        class="email-button"
                      >
                        View Your Order
                      </a>

                    </td>

                    <!-- BUTTON GAP -->

                    <td
                      class="button-gap"
                      width="8"
                    >
                      &nbsp;
                    </td>

                    <!-- VISIT STORE -->

                    <td
                      class="button-cell"
                      width="50%"
                    >

                      <a
                        href="{{shop_url}}"
                        class="email-button secondary-button"
                      >
                        Visit Our Store
                      </a>

                    </td>

                  </tr>

                </table>

              </div>

            </td>
          </tr>

          <!-- DIVIDER -->

          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <!-- FOOTER -->

          <tr>
            <td class="footer-section">

              <p class="footer-title">
                Thanks for choosing {{shop_name}} from the House of ONG.
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

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Email.png?v=1788596216"
                            alt="Email"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >

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

// Same "blank means use this" convention as the template default above,
// and the same {{token}} substitution (see renderOrderProcessingEmailTemplate)
// -- {{order_number}} is the one most merchants will actually want here,
// but any placeholder from ORDER_PROCESSING_EMAIL_PLACEHOLDERS works
// since it's rendered through the exact same function as the HTML body.
export const DEFAULT_ORDER_PROCESSING_EMAIL_SUBJECT = "Your Order {{order_number}} Is Being Processed";

/** Resolves which subject line actually gets sent -- same
 * saved-value-wins-otherwise-default pattern as
 * getOrderProcessingEmailTemplate() above, kept as its own function for
 * the same reason: the Settings page's preview and the real send path
 * must never see different answers. */
export function getOrderProcessingEmailSubject(settings) {
  return (settings && settings.orderProcessingEmailSubject) || DEFAULT_ORDER_PROCESSING_EMAIL_SUBJECT;
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

  // The HTML body needs every value HTML-escaped (it's substituted
  // straight into markup); the subject line is a plain SMTP header, not
  // HTML, so it must use the RAW values instead -- reusing the escaped
  // set here would literally show "&amp;" in a customer's inbox for any
  // shop/order name containing "&". Same underlying data, two separate
  // vars objects for the two different contexts.
  const rawVars = {
    customer_first_name: firstName,
    order_number: orderNumber,
    order_status_url: orderStatusUrl,
    shop_name: shopInfo.name,
    shop_url: shopInfo.url,
    shop_email: shopInfo.email,
    shop_logo_url: shopInfo.logoUrl,
  };
  const htmlVars = Object.fromEntries(Object.entries(rawVars).map(([key, value]) => [key, esc(value)]));
  const template = getOrderProcessingEmailTemplate(settings);
  const html = renderOrderProcessingEmailTemplate(template, htmlVars);
  const subject = renderOrderProcessingEmailTemplate(getOrderProcessingEmailSubject(settings), rawVars);

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
    subject,
    text,
    html,
  });

  return `OK: sent to ${email}`;
}
