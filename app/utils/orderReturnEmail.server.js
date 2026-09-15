/**
 * Two customer-facing emails for the manual Returns & Refunds workflow
 * (app.returns-refunds.jsx) -- "Return Received" (the returned item has
 * physically arrived back, refund is being worked on) and "Refund
 * Processed" (the refund itself has gone through). Both are sent ONE AT
 * A TIME by staff clicking a button on that page for a specific order --
 * there is no automatic trigger/webhook for either, unlike the order-
 * processing email. This mirrors orderProcessingEmail.server.js's exact
 * pattern (editable HTML template + subject, {{token}} substitution,
 * Gmail send) rather than duplicating it: the substitution function
 * itself is generic, so it's imported and reused rather than copied.
 *
 * Design matches the store's other order-lifecycle emails (native
 * Shopify notifications + the order-processing email) so every email a
 * customer gets from this store shares one visual identity.
 */
import nodemailer from "nodemailer";
import { getShopFooterInfo, esc } from "./astroAdvice.server";
import { renderOrderProcessingEmailTemplate as renderTemplate } from "./orderProcessingEmail.server";

// Documented once, here, so the Settings page's "available placeholders"
// help text and the actual substitution logic below can never drift
// apart from each other. Shared by both emails; refund_amount is only
// ever populated for the Refund Processed one (blank otherwise).
export const ORDER_RETURN_EMAIL_PLACEHOLDERS = [
  { token: "customer_first_name", description: "Customer's name (falls back to \"there\" if unknown)" },
  { token: "order_number", description: "Order number, e.g. #1000031314" },
  { token: "order_status_url", description: "Link to the customer's own order status page" },
  { token: "refund_amount", description: "Refund amount as entered by staff on the Returns & Refunds page, e.g. ₹1,500.00 (Refund Processed email only)" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store URL" },
  { token: "shop_email", description: "Store support email address" },
  { token: "shop_logo_url", description: "Store logo image URL (a sensible fallback logo is used if the store has none set)" },
];

// Shared visual shell (header logo, dividers, footer contact block) --
// byte-for-byte the same as orderProcessingEmail.server.js's own
// default template, just with a different <title> and content-section
// body passed in. Kept as one function instead of copy-pasting the
// whole shell into two separate default-template functions below.
function buildDefaultShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${title}</title>
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

    .email-wrapper {
      width: 100%;
      background-color: #f3f2ef;
    }

    .page-padding {
      padding: 32px 0;
    }

    .email-container {
      width: 500px;
      max-width: 500px;
      background-color: #ffffff;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
    }

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

    .refund-amount {
      font-weight: bold;
      color: #3d4652;
    }

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

  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td class="page-padding" align="center">
        <table class="email-container" width="500" cellpadding="0" cellspacing="0" border="0">

          <!-- HEADER -->
          <tr>
            <td class="logo-section">
              <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="100">
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
${bodyHtml}
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

              <table class="contact-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="single-contact-item website-row" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right:6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/website.png?v=1788870868" alt="Website" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="{{shop_url}}" class="contact-link">onlynaturalgemstones.com</a>
                        </td>
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
                        <td valign="middle" style="padding-right:5px;">
                          <a href="https://wa.me/919310400152">
                            <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358" alt="WhatsApp" width="18" height="18" class="contact-icon">
                          </a>
                        </td>
                        <td valign="middle">
                          <a href="https://wa.me/919310400152" class="contact-link">+91-9310-400-152</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td class="contact-item" align="center">
                    <table cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td valign="middle" style="padding-right:5px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346" alt="Phone" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="tel:+918010555111" class="contact-link">+91-8010-555-111</a>
                        </td>
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
                        <td valign="middle" style="padding-right:6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/Email.png?v=1788596216" alt="Email" width="18" height="18" class="contact-icon">
                        </td>
                        <td valign="middle">
                          <a href="mailto:{{shop_email}}" class="contact-link">{{shop_email}}</a>
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

function getDefaultReturnReceivedEmailTemplate() {
  return buildDefaultShell(
    "We've received your return",
    `                <p>Hello {{customer_first_name}},</p>

                <p>
                  We've received the item you returned for order
                  <span class="order-number">{{order_number}}</span>.
                </p>

                <p>
                  Our team is inspecting it now, and your refund will be processed shortly. You'll receive a separate email once it's done.
                </p>

                <p>
                  For more queries, please feel free to contact us.
                </p>

                <table class="button-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="button-cell" width="50%">
                      <a href="{{order_status_url}}" class="email-button">View Your Order</a>
                    </td>
                    <td class="button-gap" width="8">&nbsp;</td>
                    <td class="button-cell" width="50%">
                      <a href="{{shop_url}}" class="email-button secondary-button">Visit Our Store</a>
                    </td>
                  </tr>
                </table>`,
  );
}

function getDefaultRefundProcessedEmailTemplate() {
  return buildDefaultShell(
    "Your refund has been processed",
    `                <p>Hello {{customer_first_name}},</p>

                <p>
                  Your refund of <span class="refund-amount">{{refund_amount}}</span> for order
                  <span class="order-number">{{order_number}}</span> has been processed.
                </p>

                <p>
                  It may take 5-7 business days to reflect in your original payment method, depending on your bank.
                </p>

                <p>
                  For more queries, please feel free to contact us.
                </p>

                <table class="button-table" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="button-cell" width="50%">
                      <a href="{{order_status_url}}" class="email-button">View Your Order</a>
                    </td>
                    <td class="button-gap" width="8">&nbsp;</td>
                    <td class="button-cell" width="50%">
                      <a href="{{shop_url}}" class="email-button secondary-button">Visit Our Store</a>
                    </td>
                  </tr>
                </table>`,
  );
}

/** Same saved-value-wins-otherwise-default pattern as
 * getOrderProcessingEmailTemplate() -- the ONE place each resolution
 * happens, so the Settings page's preview and the real send path can
 * never see different answers. */
export function getReturnReceivedEmailTemplate(settings) {
  return (settings && settings.returnReceivedEmailTemplate) || getDefaultReturnReceivedEmailTemplate();
}

export const DEFAULT_RETURN_RECEIVED_EMAIL_SUBJECT = "We've Received Your Return for Order {{order_number}}";

export function getReturnReceivedEmailSubject(settings) {
  return (settings && settings.returnReceivedEmailSubject) || DEFAULT_RETURN_RECEIVED_EMAIL_SUBJECT;
}

export function getRefundProcessedEmailTemplate(settings) {
  return (settings && settings.refundProcessedEmailTemplate) || getDefaultRefundProcessedEmailTemplate();
}

export const DEFAULT_REFUND_PROCESSED_EMAIL_SUBJECT = "Your Refund for Order {{order_number}} Has Been Processed";

export function getRefundProcessedEmailSubject(settings) {
  return (settings && settings.refundProcessedEmailSubject) || DEFAULT_REFUND_PROCESSED_EMAIL_SUBJECT;
}

/** Shared by both sends below -- builds the {{token}} -> value maps
 * (raw for the subject/text, HTML-escaped for the body) from the same
 * normalized order payload shape app.order-processing.jsx's resend
 * action already used (REST-style snake_case: payload.customer.first_name,
 * payload.shipping_address.name, etc.), plus an optional refund amount
 * string for the Refund Processed email. */
async function buildTemplateVars(admin, payload, refundAmount) {
  const orderNumber = payload?.name || `#${payload?.order_number || payload?.id}`;
  const firstName =
    payload?.customer?.first_name ||
    payload?.customer?.name ||
    (payload?.shipping_address?.name || "").split(" ")[0] ||
    "there";

  const shopInfo = await getShopFooterInfo(admin);
  const orderStatusUrl = payload?.order_status_url || shopInfo.url;

  const rawVars = {
    customer_first_name: firstName,
    order_number: orderNumber,
    order_status_url: orderStatusUrl,
    refund_amount: refundAmount || "",
    shop_name: shopInfo.name,
    shop_url: shopInfo.url,
    shop_email: shopInfo.email,
    shop_logo_url: shopInfo.logoUrl,
  };
  // The HTML body needs every value HTML-escaped (substituted straight
  // into markup); the subject/text are plain, not HTML -- reusing the
  // escaped set there would show literal "&amp;" for any shop/order
  // name containing "&". Same underlying data, two vars objects.
  const htmlVars = Object.fromEntries(Object.entries(rawVars).map(([key, value]) => [key, esc(value)]));

  return { rawVars, htmlVars, firstName, orderNumber };
}

function buildTransporter(settings) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });
}

/**
 * @param {object} admin - authenticated Admin GraphQL client
 * @param {object} settings - getAppSettings(shop) result
 * @param {object} payload - normalized order payload, same shape
 *   sendOrderProcessingEmail() takes
 * @returns {Promise<string>} "OK: sent to ..." / "skipped: ..." status string
 */
export async function sendReturnReceivedEmail(admin, settings, payload) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail not configured (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }
  const email = payload?.email || payload?.customer?.email || payload?.contact_email || null;
  if (!email) return "skipped: no email address on this order";

  const { rawVars, htmlVars, firstName, orderNumber } = await buildTemplateVars(admin, payload);
  const template = getReturnReceivedEmailTemplate(settings);
  const html = renderTemplate(template, htmlVars);
  const subject = renderTemplate(getReturnReceivedEmailSubject(settings), rawVars);
  const text =
    `Hello ${firstName},\n\n` +
    `We've received the item you returned for order ${orderNumber}. Our team is inspecting it now, and your refund will be processed shortly.\n\n` +
    `For more queries, please feel free to contact us.`;

  await buildTransporter(settings).sendMail({
    from: `"${(await getShopFooterInfo(admin)).name}" <${settings.gmailUser}>`,
    to: email,
    subject,
    text,
    html,
  });

  return `OK: sent to ${email}`;
}

/**
 * @param {object} admin - authenticated Admin GraphQL client
 * @param {object} settings - getAppSettings(shop) result
 * @param {object} payload - normalized order payload, same shape as above
 * @param {string} refundAmount - the amount staff entered on the page
 *   (already formatted, e.g. "₹1,500.00") -- this function doesn't
 *   fetch or validate it against Shopify's own refund records, it just
 *   substitutes whatever staff typed in.
 * @returns {Promise<string>} "OK: sent to ..." / "skipped: ..." status string
 */
export async function sendRefundProcessedEmail(admin, settings, payload, refundAmount) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail not configured (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }
  const email = payload?.email || payload?.customer?.email || payload?.contact_email || null;
  if (!email) return "skipped: no email address on this order";

  const { rawVars, htmlVars, firstName, orderNumber } = await buildTemplateVars(admin, payload, refundAmount);
  const template = getRefundProcessedEmailTemplate(settings);
  const html = renderTemplate(template, htmlVars);
  const subject = renderTemplate(getRefundProcessedEmailSubject(settings), rawVars);
  const text =
    `Hello ${firstName},\n\n` +
    `Your refund of ${refundAmount || "—"} for order ${orderNumber} has been processed. It may take 5-7 business days to reflect in your account.\n\n` +
    `For more queries, please feel free to contact us.`;

  await buildTransporter(settings).sendMail({
    from: `"${(await getShopFooterInfo(admin)).name}" <${settings.gmailUser}>`,
    to: email,
    subject,
    text,
    html,
  });

  return `OK: sent to ${email}`;
}
