/**
 * GST tax invoice — generated and emailed (as a PDF attachment) only when
 * a merchant explicitly clicks "Send Invoice" on the Shopify order page
 * (see extensions/order-invoice-action) — never automatically. Shopify's
 * own notification system can't attach files to any email, for any
 * notification type, so this has to live in the app instead of the
 * Notifications editor (per explicit discussion).
 *
 * GSTIN/legal name/address/rates all come from AppSettings (Settings
 * page), not Shopify's own Taxes-and-duties GST registration screen —
 * that data isn't reliably readable via the Admin API, and the merchant
 * explicitly asked for these to live in the app instead.
 *
 * PDF rendering is pdfmake + html-to-pdfmake + jsdom -- deliberately NOT
 * a headless-browser approach (Puppeteer etc.) per explicit request, to
 * avoid the RAM a real Chromium process needs on this app's small Render
 * plan. Trade-off: only pdfmake's supported HTML/CSS subset renders
 * (table-based layouts, borders, basic text styling, images) --
 * flexbox/grid/absolute positioning will not. Keep invoicePdfTemplate in
 * that same table-based style the rest of this store's transactional
 * emails already use.
 */
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { esc, getShopFooterInfo } from "./astroAdvice.server";
import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import htmlToPdfmake from "html-to-pdfmake";
import { JSDOM } from "jsdom";

pdfMake.vfs = pdfFonts;

export const DEFAULT_INVOICE_NUMBER_PREFIX = "INV-";

// The exact product title the locked Gemstone Customisation pricing
// system (see CLAUDE.md) always uses for its shared charge-line product
// -- this is the one reliable signal for "this line is a customisation
// charge, not the gemstone itself", used to pick which GST rate applies.
const CUSTOMISATION_PRODUCT_TITLE = "Gemstone Customisation";

// Documented once, here, so the Settings page's "available placeholders"
// help text and the actual substitution logic below can never drift
// apart. line_items_rows is pre-rendered HTML, one <tr> per line with its
// own CGST/SGST/IGST columns already computed (a real templating loop
// isn't worth the added complexity/fragility for one page's worth of
// rows -- see renderOrderInvoiceTemplate's own
// comment for the same reasoning already established for the order-
// processing email template).
export const ORDER_INVOICE_PLACEHOLDERS = [
  { token: "brand_header_html", description: "Your shop's logo image if one loads, otherwise your business name as text" },
  { token: "seal_html", description: "Your signature/seal image (Settings page) if one's set, otherwise blank" },
  { token: "invoice_number", description: "e.g. INV-000123 -- assigned once per order, permanently" },
  { token: "invoice_date", description: "Date the invoice was generated, DD/MM/YYYY" },
  { token: "order_number", description: "Shopify order number, e.g. #1000031314" },
  { token: "customer_name", description: "Customer's full name" },
  { token: "customer_email", description: "Customer's email address" },
  { token: "customer_phone", description: "Customer's phone number, if on the order" },
  { token: "billing_address", description: "Formatted billing address (multi-line HTML)" },
  { token: "shipping_address", description: "Formatted shipping address (multi-line HTML)" },
  { token: "info_block_rows", description: "Pre-built 3-column seller/customer/delivery block, one real table row per line (keeps columns top-aligned regardless of length)" },
  { token: "seller_legal_name", description: "Your registered business name (Settings page)" },
  { token: "seller_address", description: "Your registered business address (Settings page)" },
  { token: "seller_phone", description: "Your business phone (Settings page)" },
  { token: "seller_email", description: "Your business support email (Settings page)" },
  { token: "seller_gstin", description: "Your GSTIN (Settings page)" },
  { token: "sales_person", description: "Defaults to your registered business name" },
  { token: "delivery_mode", description: "The order's actual shipping method, if any" },
  { token: "delivery_before", description: "Order date + your configured delivery-days setting" },
  { token: "payment_mode", description: "The order's actual payment gateway (e.g. Razorpay)" },
  { token: "line_items_rows", description: "Pre-built HTML table rows: item, HSN, qty, rate, CGST, SGST, IGST, amount" },
  { token: "subtotal", description: "Sum of all line items before GST" },
  { token: "total_gst", description: "Total GST amount across all lines" },
  { token: "grand_total", description: "Subtotal + total GST" },
  { token: "total_in_words", description: "Grand total spelled out, e.g. \"Indian Rupee One Only\"" },
  { token: "tax_treatment_note", description: "Reserved, currently always blank (GST applies even internationally, as IGST)" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store URL" },
];

// IMPORTANT -- pdfmake only, no <style> block: html-to-pdfmake's own
// parseStyle() (confirmed by reading its source directly) reads ONLY an
// element's inline `style="..."` attribute -- it never parses a
// <style> block or matches CSS classes at all, unlike a browser. A
// <style>-based version of this template would render correctly in the
// Settings page's iframe preview (a real browser, which DOES apply
// class-based CSS) while looking completely different in the actual
// PDF -- this was a real, previously-undiagnosed bug (confirmed live:
// the "gap on the right side" report was pdfmake auto-sizing the items
// table's columns to their short content, with no `width:100%` inline
// style anywhere to trigger its "stretch to fill" behavior, leaving
// the whole table narrower than the page). Every element below is
// therefore styled with a `style="..."` attribute directly -- no
// class, no <style> block -- so the browser preview and the real PDF
// render identically. If you're hand-editing this template, the same
// rule applies: styling that isn't inline will look right in the
// Settings-page preview and silently vanish from the real PDF.
//
// SECOND gotcha, also confirmed by hand: do NOT set an inline
// `font-family` anywhere in this template. Only the four Roboto
// weights bundled in pdfmake's own vfs_fonts.js are actually
// registered fonts here (no headless browser means no system fonts
// either) -- an inline `font-family: Helvetica, Arial, ...` makes
// html-to-pdfmake emit `font: "Helvetica"`, which pdfmake then can't
// find and throws `Font 'Helvetica' in style 'normal' is not defined`,
// failing the PDF generation for every single invoice. Leaving
// font-family unset falls back to pdfmake's own default (Roboto),
// which is always safe.
function getDefaultOrderInvoiceTemplate() {
  // pdfmake has NO concept of a border on a <table> element itself --
  // only on individual <td>/<th> CELLS (a per-cell 4-side boolean
  // array). A border/border-bottom/border-top style placed on a
  // <table> tag gets attached to the wrong object in html-to-pdfmake's
  // own output (confirmed by inspecting its JSON directly) and pdfmake
  // silently ignores it there -- while any cell that never got an
  // explicit border style of its own falls back to pdfmake's default
  // grid-lines-everywhere table look. Together that produces exactly
  // the "boxes nested inside boxes, not edge to edge" look reported
  // live: every nested table quietly grew pdfmake's own default grid
  // instead of the invisible layout-only wrapper it was meant to be,
  // while the intended divider lines (border-bottom under the info
  // block, border-top above the terms paragraph, etc.) never actually
  // rendered at all, because that's where their `style` had been put.
  //
  // Fix: every border below sits on an actual <td>, never a <table>,
  // and every cell that should show NO border says so explicitly
  // (`border:none`, not just omitting the property) -- an unstated
  // border on a pdfmake table cell defaults to VISIBLE, the opposite
  // of how a bare HTML <td> behaves in a browser. The outer box's
  // continuous rectangle is built by giving every row's cell its own
  // left+right edge, with the top edge only on the first row and the
  // bottom edge only on the last -- there is no such thing as "border
  // around this whole table" to fall back on.
  const boxTopSides = "border:none;border-top:1px solid #333;border-left:1px solid #333;border-right:1px solid #333;";
  const boxSides = "border:none;border-left:1px solid #333;border-right:1px solid #333;";
  const boxBottomSides = "border:1px solid #333;";
  const cellReset = "border:none;padding:0;";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-size: 10px; color: #222;">

  <div style="text-align:center;margin-bottom:10px;">{{brand_header_html}}</div>

  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="${boxTopSides}padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;border-bottom:1px solid #333;padding:8px 10px;font-size:12px;font-weight:bold;">TAX INVOICE # {{invoice_number}}</td>
            <td style="border:none;border-bottom:1px solid #333;padding:8px 10px;font-size:12px;font-weight:bold;text-align:right;">Date : {{invoice_date}}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="${boxSides}padding:8px 0 0;">
        <table style="width:100%;border-collapse:collapse;">
          {{info_block_rows}}
          <tr>
            <td style="border:none;border-bottom:1px solid #333;padding-top:6px;font-size:1px;line-height:1px;">&nbsp;</td>
            <td style="border:none;border-bottom:1px solid #333;padding-top:6px;font-size:1px;line-height:1px;">&nbsp;</td>
            <td style="border:none;border-bottom:1px solid #333;padding-top:6px;font-size:1px;line-height:1px;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="${boxSides}padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="width:24%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">ITEM(s) DESCRIPTION</th>
            <th style="width:8%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">HSN</th>
            <th style="width:6%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">Qty</th>
            <th style="width:13%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">RATE (₹)</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">CGST</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">SGST</th>
            <th style="width:12%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">IGST</th>
            <th style="width:13%;background:#f3efe6;border:1px solid #999;padding:6px 8px;font-size:9.5px;text-align:left;">AMOUNT (₹)</th>
          </tr>
          {{line_items_rows}}
        </table>
      </td>
    </tr>
    <tr>
      <td style="${boxSides}padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;vertical-align:top;padding:10px;font-size:10px;">
              Total In Words<br>
              <b>{{total_in_words}}</b><br><br>
              Payment Mode : {{payment_mode}}
            </td>
            <td style="border:none;width:45%;vertical-align:top;padding:10px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="border:none;font-size:10px;padding:2px 0;">Sub Total</td>
                  <td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{subtotal}}</td>
                </tr>
                <tr>
                  <td style="border:none;font-size:10px;padding:2px 0;">Total GST</td>
                  <td style="border:none;font-size:10px;padding:2px 0;text-align:right;">{{total_gst}}</td>
                </tr>
                <tr>
                  <td style="border:none;border-top:1px solid #333;font-size:12px;font-weight:bold;padding:4px 0;">Total</td>
                  <td style="border:none;border-top:1px solid #333;font-size:12px;font-weight:bold;padding:4px 0;text-align:right;">{{grand_total}}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="${boxTopSides}font-size:8.5px;color:#555;line-height:1.5;padding:10px;">
        The Amount Received against Gemstone / Jewellery is Non-refundable. In case of any defect related to Gemstones / Jewellery, the Customer has to return the goods within 3 days after
        purchase. We take full responsibility if the sold gemstone is synthetic (man-made) and the full amount will be refunded. We take no responsibility if the Gemstone / Jewellery gets damaged in
        any way after it is delivered to the Client. Customised Jewellery — including personalised / engraved products manufactured to specific customer instructions — is not eligible for return /
        money back. Any item showing signs of wear, or that has been engraved, altered, resized or otherwise damaged, will not be accepted for return. All matters / disputes subject to Delhi
        Jurisdiction.
      </td>
    </tr>
    <tr>
      <td style="${boxTopSides}padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border:none;width:55%;padding:14px 10px;vertical-align:top;">
              I have read, understood and agreed to the terms &amp; conditions.<br><br>
              Customer Signature : {{customer_name}}
            </td>
            <td style="border:none;width:45%;padding:14px 10px;vertical-align:top;text-align:right;">
              For {{seller_legal_name}}<br>
              {{seal_html}}
              Authorised Seal &amp; Signatory
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="${boxBottomSides}text-align:center;font-size:9px;color:#666;padding:8px;">This is a Computer Generated Invoice — {{shop_name}} ({{shop_url}})</td>
    </tr>
  </table>

</body>
</html>`;
}

/** Resolves which template HTML actually gets used -- a saved
 * AppSettings.invoicePdfTemplate wins, the built-in default above
 * otherwise. The ONE place this decision is made, so a Settings-page
 * preview and the real send path can never quietly see different
 * answers. */
export function getOrderInvoiceTemplate(settings) {
  return (settings && settings.invoicePdfTemplate) || getDefaultOrderInvoiceTemplate();
}

// The EMAIL's own placeholder list -- deliberately a different, smaller
// set than ORDER_INVOICE_PLACEHOLDERS above, since the email body never
// needs the GST/line-item breakdown (that only ever lives in the
// attached PDF) -- it's just the wrapper message announcing the invoice.
export const ORDER_INVOICE_EMAIL_PLACEHOLDERS = [
  { token: "customer_first_name", description: "Customer's name (falls back to \"there\" if unknown)" },
  { token: "order_number", description: "Order number, e.g. #1000031314" },
  { token: "invoice_number", description: "e.g. INV-000123" },
  { token: "order_status_url", description: "Link to the customer's own order status page" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store URL" },
  { token: "shop_email", description: "Store support email address" },
  { token: "shop_logo_url", description: "Store logo image URL (a sensible fallback logo is used if the store has none set)" },
];

// Matches the visual identity of this store's other transactional emails
// (native Shopify notifications + the order-processing email) --
// logo/wordmark header on a cream band, divider, content card, footer
// with address + WhatsApp/call/email rows -- per explicit request, so
// the invoice email doesn't look like a different product. Content is
// invoice-specific: announces the attached PDF rather than a status
// change.
function getDefaultInvoiceEmailTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Your invoice is here</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width">
  <style type="text/css">
.gt a{color:#222!important;text-decoration:none!important}
body{margin:0;padding:0;width:100%;background-color:#f3f2ef;font-family:Arial,Helvetica,sans-serif;color:#4f5965}
table{border-spacing:0;border-collapse:collapse} img{border:0;display:block} a{text-decoration:none}
.email-wrapper{width:100%;background-color:#f3f2ef}.page-padding{padding:32px 0}
.email-container{width:500px;max-width:500px;background-color:#fff;border-radius:0 0 12px 12px;overflow:hidden}
.logo-section{padding:28px 20px 25px;text-align:center;background-color:#fffcf3;border-top:5px solid #8c7a4e}
.logo-section img{max-width:100px;width:auto;height:auto;margin:0 auto}
.logo-text{margin:0;font-size:30px;font-weight:normal;color:#a76642}
.divider-cell{padding-left:0;padding-right:0}.divider{height:1px;background-color:#d5d0c8;width:100%;font-size:1px;line-height:1px}
.content-section{padding:30px 28px 25px;font-size:15px;line-height:1.6;color:#4f5965;background-color:#fff}
.content-inner{width:100%;margin:0 auto}.content-section p{margin-top:0;margin-bottom:18px}
.order-number,.complete-status{font-weight:bold;color:#3d4652}
.button-table{width:100%;margin-top:20px;margin-bottom:10px}.button-cell{width:50%;vertical-align:middle}
.button-gap{width:8px;min-width:8px;font-size:1px;line-height:1px}
.email-button{display:block;width:100%;box-sizing:border-box;text-align:center;background-color:#8c7a4e;color:#fff!important;padding:11px 5px;font-size:14px;font-weight:500;line-height:16px;border-radius:3px;white-space:nowrap;text-decoration:none!important}
.secondary-button{background-color:#fff;color:#8c7a4e!important;border:1px solid #8c7a4e;padding:10px 5px}
.footer-section{padding:14px 18px 16px;text-align:center;color:#4f5965;background-color:#fffcf3}
.footer-title{margin:0 0 8px;font-size:14px;line-height:1.45;color:#4f5965}
.address{margin:0 0 10px;font-size:13px;line-height:1.45;color:#333!important}.address a{color:#333!important;text-decoration:none!important}
.contact-table{width:100%;margin:0 auto;table-layout:fixed}.website-row{padding-bottom:8px}
.contact-item{width:50%;padding:3px 2px;text-align:center;vertical-align:middle;font-size:13px;line-height:18px}
.single-contact-item{padding:3px 2px;text-align:center;vertical-align:middle;font-size:13px;line-height:18px}
.contact-link{color:#333!important;text-decoration:none!important;white-space:nowrap}
.contact-icon{width:18px;height:18px;display:block}
@media only screen and (max-width:600px){
.page-padding{padding:0!important}.email-container{width:100%!important;max-width:100%!important;border-radius:0!important}
.logo-section{padding:22px 15px!important}.logo-section img{max-width:100px!important}
.content-section{padding:24px 20px 18px!important;font-size:16px!important}
.button-table{width:100%!important;margin-top:18px!important;margin-bottom:10px!important}.button-gap{width:8px!important;min-width:8px!important}
.email-button{font-size:13px!important;line-height:16px!important;padding:10px 3px!important}.secondary-button{padding:9px 3px!important}
.footer-section{padding:12px 12px 14px!important}.footer-title{font-size:14px!important;line-height:1.4!important;margin-bottom:7px!important}
.address{font-size:13px!important;line-height:1.4!important;margin-bottom:8px!important}.website-row{padding-bottom:6px!important}
.contact-item,.single-contact-item{padding:3px 1px!important;font-size:13px!important}.contact-link{white-space:nowrap!important}
}
</style>
</head>


<body>

  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td class="page-padding" align="center">

        <table class="email-container" width="500" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td class="logo-section">
              <img src="{{shop_logo_url}}" alt="{{shop_name}}" width="100">
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
                  Thank you for your order
                  <span class="order-number">{{order_number}}</span>.
                  Your GST tax invoice
                  <span class="order-number">{{invoice_number}}</span>
                  is attached to this email as a PDF.
                </p>

                <p style="margin-top: 0; margin-bottom: 0;">
                  Best Wishes &amp; Regards!
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
                </table>

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

              <p class="footer-title">
                Thanks for choosing {{shop_name}} from the House of Shubh Gems.
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
                        <td valign="middle" style="padding-right: 6px;">
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
                        <td valign="middle" style="padding-right: 6px;">
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
                        <td valign="middle" style="padding-right: 6px;">
                          <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346" alt="Call" width="18" height="18" class="contact-icon">
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
                        <td valign="middle" style="padding-right: 6px;">
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

/** Resolves which HTML actually gets sent as the invoice EMAIL body -- a
 * saved AppSettings.invoiceEmailTemplate wins, the built-in default
 * above otherwise. Separate resolution function from
 * getOrderInvoiceTemplate (the attached PDF's own template) so the two
 * "use the default" fallbacks can never be confused for each other. */
export function getInvoiceEmailTemplate(settings) {
  return (settings && settings.invoiceEmailTemplate) || getDefaultInvoiceEmailTemplate();
}

/** Plain {{token}} substitution -- deliberately not a templating engine
 * (no conditionals/loops), same reasoning already established for
 * renderOrderProcessingEmailTemplate: every value this needs is always
 * available by the time this runs, so nothing actually needs branching,
 * and a merchant hand-editing the HTML on the Settings page can't break
 * the send path with a syntax error the way a real templating language
 * could. Tolerates both {{token}} and {{ token }}. */
export function renderOrderInvoiceTemplate(templateHtml, vars) {
  let html = templateHtml;
  for (const [key, value] of Object.entries(vars)) {
    const safe = value != null ? String(value) : "";
    html = html.split(`{{${key}}}`).join(safe).split(`{{ ${key} }}`).join(safe);
  }
  return html;
}

/** Assigns (or reuses) this order's invoice number -- per explicit
 * request, derived directly from the Shopify ORDER number rather than
 * an independent sequential counter: {prefix}{order's own digits}, e.g.
 * order "ONG1028" + prefix "IN-" -> "IN-1028". An order that already
 * has an OrderInvoice row keeps its originally-assigned number forever
 * (re-sending never recomputes it, so a later change to the prefix
 * setting can't silently change a previously-issued invoice's number).
 *
 * Trade-off worth knowing: unlike the previous independent
 * increment-by-1 counter, this does NOT guarantee a gap-free sequence
 * for GST purposes on its own -- Shopify order numbers skip over
 * cancelled/test/abandoned-checkout orders that never get invoiced, so
 * the invoice numbers actually issued can have gaps. Only use this if
 * that's acceptable for your own GST filing; the previous scheme is
 * still available by setting AppSettings.invoiceNextNumber again if
 * ever needed. */
export async function getOrCreateInvoiceNumber(shop, orderId, orderName) {
  const existing = await prisma.orderInvoice.findUnique({ where: { orderId } });
  if (existing) return { invoiceNumber: existing.invoiceNumber, isNew: false };

  const settingsRow = await prisma.appSettings.findUnique({ where: { shop } });
  const prefix = settingsRow?.invoiceNumberPrefix || DEFAULT_INVOICE_NUMBER_PREFIX;
  const orderDigits = (orderName || "").replace(/\D/g, "") || "000000";
  const invoiceNumber = `${prefix}${orderDigits}`;

  await prisma.orderInvoice.create({
    data: { shop, orderId, orderName, invoiceNumber },
  });

  return { invoiceNumber, isNew: true };
}

/** pdfmake never fetches a remote URL itself -- html-to-pdfmake just
 * passes an <img>'s `src` straight through as pdfmake's `image`
 * property, which only accepts a data URI (or a pre-registered vfs
 * key). So a logo/seal image has to be fetched and inlined as base64
 * server-side BEFORE the HTML reaches htmlToPdfmake, or pdfmake throws
 * trying to render it. Returns null (never throws) on any failure --
 * a slow/broken image URL should degrade to "no image" on the
 * invoice, not break the whole send. */
async function fetchImageAsDataUri(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    // A logo/seal has no business being this large -- caps how much an
    // oversized image can bloat every single invoice PDF/email.
    if (buffer.length > 2 * 1024 * 1024) return null;
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("[orderInvoice] failed to fetch image for PDF:", url, err.message);
    return null;
  }
}

function formatMoney(amount, currencyCode) {
  const value = parseFloat(amount) || 0;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode || "INR", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currencyCode || ""} ${value.toFixed(2)}`;
  }
}

/** `includeName`/`includePhone` default to true for general use, but the
 * invoice PDF's customer block already shows {{customer_name}} and
 * {{customer_phone}} as their own separate fields (with their own
 * billing/shipping fallback logic) -- passing both false there avoids
 * printing the same name and phone number twice, once from this
 * function's own lines and once from the template's dedicated tokens. */
function formatAddressLines(address, { includeName = true, includePhone = true } = {}) {
  if (!address) return [];
  return [
    includeName ? address.name : null,
    [address.address1, address.address2].filter(Boolean).join(", "),
    [address.city, address.province, address.zip].filter(Boolean).join(", "),
    address.country,
    includePhone && address.phone ? `Phone: ${address.phone}` : null,
  ].filter(Boolean).map(esc);
}

function formatAddress(address, opts) {
  return formatAddressLines(address, opts).join("<br>");
}

/** Builds the invoice PDF's 3-column info block (seller | customer |
 * delivery) as real per-line table ROWS -- one <tr> per line index,
 * zipped across all three columns, blank <td> once a column runs out
 * of lines -- rather than one <td> per column each containing a
 * multi-line stack. This is deliberate, not just a style choice:
 * pdfmake does not reliably respect `vertical-align: top` when cells
 * in the same row hold a different number of lines (confirmed live --
 * the shorter columns visibly drifted instead of staying pinned to the
 * row's top edge). Giving every line its own real table row sidesteps
 * that entirely, since a single-line cell has nothing to vertically
 * misalign in the first place. Matches the reference invoice's own
 * layout, which stays top-aligned per column regardless of how many
 * lines each one has. */
function buildInfoBlockRows(col1Lines, col2Lines, col3Lines) {
  const maxLen = Math.max(col1Lines.length, col2Lines.length, col3Lines.length);
  let rows = "";
  for (let i = 0; i < maxLen; i++) {
    rows +=
      `<tr>` +
      `<td style="border:none;width:38%;padding:1px 10px 1px 0;font-size:10px;line-height:1.5;">${col1Lines[i] || ""}</td>` +
      `<td style="border:none;width:38%;padding:1px 10px;font-size:10px;line-height:1.5;">${col2Lines[i] || ""}</td>` +
      `<td style="border:none;width:24%;padding:1px 0 1px 10px;font-size:10px;line-height:1.5;">${col3Lines[i] || ""}</td>` +
      `</tr>`;
  }
  return rows;
}

/** Fetches everything about the order this invoice needs, in one
 * GraphQL call -- variant.inventoryItem.harmonizedSystemCode is the
 * native per-variant HS code field Shopify already provides for customs/
 * duties (Settings -> the variant's own "Harmonized System (HS) code"
 * field), reused here rather than inventing a second place to store it,
 * per explicit request. */
export async function fetchOrderForInvoice(admin, orderGid) {
  const res = await admin.graphql(
    `#graphql
    query OrderForInvoice($id: ID!) {
      order(id: $id) {
        id
        name
        createdAt
        email
        paymentGatewayNames
        shippingLine { title }
        customer { firstName lastName email }
        billingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
        shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 100) {
          nodes {
            id
            title
            quantity
            discountedTotalSet { shopMoney { amount currencyCode } }
            originalTotalSet { shopMoney { amount currencyCode } }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            customAttributes { key value }
            variant {
              id
              title
              sku
              product {
                title
                collections(first: 10) { nodes { id title } }
              }
              inventoryItem { harmonizedSystemCode }
            }
          }
        }
      }
    }`,
    { variables: { id: orderGid } },
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`OrderForInvoice query failed: ${JSON.stringify(json.errors)}`);
  }
  const order = json.data?.order;
  if (!order) throw new Error(`Order ${orderGid} not found`);
  return order;
}

/** Pre-fills the Settings page's seller name/address/phone/state fields
 * from the shop's own Shopify billing address, per explicit request --
 * "auto fetch seller details from shopify". Deliberately does NOT
 * return a GSTIN (not reliably exposed via the Admin API at all -- see
 * this file's own header comment) or an email (Shopify's `shop.email`
 * is the store owner's account email, not necessarily the public
 * business contact address -- same reasoning astroAdvice.server.js's
 * getShopFooterInfo already uses for its own footer email). `province`
 * doubles as invoiceSellerState, which is what actually decides
 * CGST+SGST vs IGST -- see computeInvoiceGst(). */
export async function fetchShopSellerInfo(admin) {
  const res = await admin.graphql(
    `#graphql
    query ShopSellerInfo {
      shop {
        name
        billingAddress { address1 address2 city province zip country phone }
      }
    }`,
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`ShopSellerInfo query failed: ${JSON.stringify(json.errors)}`);
  }
  const shop = json.data?.shop;
  if (!shop) throw new Error("Shop info not found");
  const a = shop.billingAddress || {};
  return {
    legalName: shop.name || "",
    address: [a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(", "), a.country]
      .filter(Boolean)
      .join("\n"),
    phone: a.phone || "",
    state: a.province || "",
  };
}

/** Bulk version of fetchOrderForInvoice -- same field selection (kept in
 * sync by hand, small enough that a shared fragment isn't worth the
 * indirection), but for the last N orders in one call rather than one
 * order by id. Powers the /app/invoices page's "show every order with
 * its tax already computed" list -- per explicit request, a merchant
 * shouldn't have to search for an order before seeing anything. */
export async function fetchRecentOrdersForInvoice(admin, first = 30, after = null) {
  const res = await admin.graphql(
    `#graphql
    query RecentOrdersForInvoice($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          createdAt
          email
          paymentGatewayNames
          shippingLine { title }
          customer { firstName lastName email }
          billingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
          shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
          currentSubtotalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 100) {
            nodes {
              id
              title
              quantity
              discountedTotalSet { shopMoney { amount currencyCode } }
              originalTotalSet { shopMoney { amount currencyCode } }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              customAttributes { key value }
              variant {
                id
                title
                sku
                product {
                  title
                  collections(first: 10) { nodes { id title } }
                }
                inventoryItem { harmonizedSystemCode }
              }
            }
          }
        }
      }
    }`,
    { variables: { first, after } },
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`RecentOrdersForInvoice query failed: ${JSON.stringify(json.errors)}`);
  }
  return {
    orders: json.data?.orders?.nodes || [],
    pageInfo: json.data?.orders?.pageInfo || { hasNextPage: false, endCursor: null },
  };
}

/** Splits an order's lines into GST-computed rows, aggregates the tax
 * breakdown, and pre-renders both as HTML table rows -- see the
 * ORDER_INVOICE_PLACEHOLDERS comment for why this is plain HTML rather
 * than a template loop. */
export function computeInvoiceGst(order, settings) {
  const currency = order.currentSubtotalPriceSet?.shopMoney?.currencyCode || "INR";
  const shipTo = order.shippingAddress || order.billingAddress;
  const isDomestic = !shipTo || !shipTo.countryCodeV2 || shipTo.countryCodeV2 === "IN";
  const sellerState = (settings.invoiceSellerState || "").trim().toLowerCase();
  const customerState = (shipTo?.province || "").trim().toLowerCase();
  // Same-state (CGST+SGST) only ever applies within India -- an
  // international order always falls through to the IGST bucket below,
  // same as a different-state domestic one, per explicit request: GST
  // still applies on exports here (this store does not zero-rate them
  // under LUT), it's just always charged as IGST rather than split.
  const sameState = isDomestic && sellerState && customerState && sellerState === customerState;

  // The gemstone line and the "Gemstone Customisation" charge line each
  // have their OWN rate by default, tracked completely independently --
  // per explicit request ("separate gst for gemstone and customisation")
  // even though they currently happen to both be set to the same
  // number. Whether the order is loose-only or has a customisation line
  // attached doesn't change the gemstone line's own rate at all; it's
  // simply whichever product the line actually is.
  const rateLoose = parseFloat(settings.invoiceGstRateLoose) || 0;
  const rateCustomisation = parseFloat(settings.invoiceGstRateCustomisation) || 0;
  // Per-collection overrides for the gemstone line -- different gemstone
  // types can carry different real HSN rates, not just one flat "loose"
  // number. {collectionGid: rateString} -- see the Settings page.
  const collectionRates = settings.invoiceCollectionGstRates || {};

  // First pass: for every gemstone (non-customisation) line, resolve its
  // own collection override (if any of its product's collections has one
  // configured -- first match wins if it belongs to more than one
  // configured collection), keyed by its variant id so the second pass
  // below can look it up by the customisation line's "_Linked Gemstone"
  // property. Per explicit request, when a gemstone HAS an override, its
  // OWN linked customisation charge line inherits that same override
  // rate too, instead of the flat invoiceGstRateCustomisation.
  const gemstoneOverrideByVariantId = {};
  for (const line of order.lineItems?.nodes || []) {
    if (line.variant?.product?.title === CUSTOMISATION_PRODUCT_TITLE) continue;
    const collectionIds = (line.variant?.product?.collections?.nodes || []).map((c) => c.id);
    const matchedGid = collectionIds.find((gid) => collectionRates[gid] !== undefined);
    if (matchedGid && line.variant?.id) {
      const numericId = line.variant.id.split("/").pop();
      gemstoneOverrideByVariantId[numericId] = parseFloat(collectionRates[matchedGid]) || 0;
    }
  }

  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  const itemRows = [];

  for (const line of order.lineItems?.nodes || []) {
    const taxableValue = parseFloat(line.discountedTotalSet?.shopMoney?.amount ?? line.originalTotalSet?.shopMoney?.amount ?? 0) || 0;
    const unitRate = parseFloat(line.originalUnitPriceSet?.shopMoney?.amount ?? 0) || 0;
    subtotal += taxableValue;

    // GST always applies -- domestic or international -- at this line's
    // own rate. The only thing international/different-state-domestic
    // changes is which bucket (CGST+SGST vs IGST) it's charged under,
    // never whether it's charged at all.
    const isCustomisation = line.variant?.product?.title === CUSTOMISATION_PRODUCT_TITLE;
    const ownVariantId = line.variant?.id ? line.variant.id.split("/").pop() : null;
    const linkedGemstoneId = isCustomisation
      ? (line.customAttributes || []).find((a) => a.key === "_Linked Gemstone")?.value || null
      : null;

    let rate;
    if (isCustomisation) {
      rate = linkedGemstoneId && gemstoneOverrideByVariantId[linkedGemstoneId] !== undefined
        ? gemstoneOverrideByVariantId[linkedGemstoneId]
        : rateCustomisation;
    } else {
      rate = ownVariantId && gemstoneOverrideByVariantId[ownVariantId] !== undefined
        ? gemstoneOverrideByVariantId[ownVariantId]
        : rateLoose;
    }
    const gstAmount = (taxableValue * rate) / 100;

    // Same bucketing decision for every line on the order (it's driven by
    // one shipping address, not per-line) -- only the RATE varies line to
    // line, matching the reference invoice's per-line CGST/SGST/IGST
    // columns (each showing both the amount and the % that produced it).
    let lineCgst = 0, lineSgst = 0, lineIgst = 0;
    let cgstPct = 0, sgstPct = 0, igstPct = 0;
    if (sameState) {
      lineCgst = gstAmount / 2;
      lineSgst = gstAmount / 2;
      cgstPct = rate / 2;
      sgstPct = rate / 2;
    } else {
      lineIgst = gstAmount;
      igstPct = rate;
    }
    totalCgst += lineCgst;
    totalSgst += lineSgst;
    totalIgst += lineIgst;

    const hsn = line.variant?.inventoryItem?.harmonizedSystemCode || "";
    const sku = line.variant?.sku || "";
    const lineTotal = taxableValue + gstAmount;
    const pct = (n) => (Number.isInteger(n) ? n : n.toFixed(2)).toString();
    // Inline styles matching the default template's header cells
    // (widths included) -- pdfmake's HTML converter reads ONLY inline
    // `style="..."` attributes, never a <style> block or CSS classes
    // (confirmed by reading html-to-pdfmake's own source), so these
    // rows must carry their own styling directly or they render
    // unstyled/unwidthed in the real PDF even though a browser preview
    // would look fine either way. See getDefaultOrderInvoiceTemplate's
    // own comment for the full explanation.
    const td = (width) => `border:1px solid #999;padding:6px 8px;vertical-align:top;font-size:9.5px;width:${width}%;`;
    itemRows.push(
      `<tr>` +
        `<td style="${td(24)}">${esc(line.title)}${sku ? `<br><span style="color:#888;font-size:9px;">SKU: ${esc(sku)}</span>` : ""}</td>` +
        `<td style="${td(8)}">${esc(hsn)}</td>` +
        `<td style="${td(6)}">${line.quantity}</td>` +
        `<td style="${td(13)}">${formatMoney(unitRate, currency)}</td>` +
        `<td style="${td(12)}">${formatMoney(lineCgst, currency)}<br><span style="color:#888;font-size:9px;">(${pct(cgstPct)}%)</span></td>` +
        `<td style="${td(12)}">${formatMoney(lineSgst, currency)}<br><span style="color:#888;font-size:9px;">(${pct(sgstPct)}%)</span></td>` +
        `<td style="${td(12)}">${formatMoney(lineIgst, currency)}<br><span style="color:#888;font-size:9px;">(${pct(igstPct)}%)</span></td>` +
        `<td style="${td(13)}">${formatMoney(lineTotal, currency)}</td>` +
      `</tr>`,
    );
  }

  const totalGst = totalCgst + totalSgst + totalIgst;

  return {
    currency,
    isDomestic,
    subtotal,
    totalGst,
    grandTotal: subtotal + totalGst,
    lineItemsRowsHtml: itemRows.join(""),
    // No special export/zero-rated note -- GST is charged on
    // international orders here too (as IGST), not exempted.
    taxTreatmentNote: "",
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Indian-numbering (lakh/crore) integer-to-words, rupees only -- e.g.
 * 132000 -> "One Lakh Thirty Two Thousand". Used for the invoice's
 * "Total In Words" line, matching the reference invoice's wording style
 * ("Indian Rupee One Only"). */
function numberToWordsIndian(num) {
  num = Math.max(0, Math.round(num));
  if (num === 0) return "Zero";
  const twoDigits = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
  const threeDigits = (n) => {
    let str = "";
    if (n >= 100) {
      str += ONES[Math.floor(n / 100)] + " Hundred";
      n %= 100;
      if (n) str += " ";
    }
    if (n) str += twoDigits(n);
    return str;
  };
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const rest = num;
  const parts = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

function totalInWords(amount, currencyCode) {
  const currencyName = currencyCode === "INR" || !currencyCode ? "Indian Rupee" : currencyCode;
  return `${currencyName} ${numberToWordsIndian(amount)} Only`;
}

/** Renders the merchant's invoice template into a PDF Buffer via
 * pdfmake, going through html-to-pdfmake/jsdom to convert the (already
 * placeholder-substituted) HTML — see this file's own header comment
 * for why this path was chosen over a headless browser. */
export async function generateInvoicePdfBuffer(html) {
  const { window } = new JSDOM("");
  const converted = htmlToPdfmake(html, { window });
  const docDefinition = { content: converted, defaultStyle: { fontSize: 10 }, pageMargins: [30, 30, 30, 30] };
  const pdfDoc = pdfMake.createPdf(docDefinition);
  return pdfDoc.getBuffer();
}

/**
 * Generates (or re-generates, reusing the same invoice number) the GST
 * invoice PDF for one order and emails it as an attachment — the only
 * entry point the "Send Invoice" admin action extension's backend route
 * calls.
 *
 * @param {object} admin - authenticated Admin GraphQL client
 * @param {object} settings - getAppSettings(shop) result
 * @param {string} shop - the shop domain
 * @param {string} orderGid - gid://shopify/Order/...
 * @returns {Promise<string>} "OK: .../FAILED: ..." status string, same
 *   convention as every other send* helper in this app
 */
export async function sendOrderInvoiceEmail(admin, settings, shop, orderGid) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail not configured (Settings page)";
  }
  if (!settings.invoiceGstin) {
    return "skipped: GSTIN not set (Settings page)";
  }

  const order = await fetchOrderForInvoice(admin, orderGid);
  const email = order.customer?.email || order.email || order.billingAddress?.email;
  if (!email) {
    return "skipped: no email address on this order";
  }

  const { invoiceNumber } = await getOrCreateInvoiceNumber(shop, orderGid, order.name);
  const gst = computeInvoiceGst(order, settings);

  const customerName =
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") ||
    order.billingAddress?.name ||
    order.shippingAddress?.name ||
    "Customer";

  // DD/MM/YYYY throughout, matching the reference invoice's date format
  // exactly (not the "13 August 2026" long form used elsewhere in this
  // app's emails).
  const formatDateDMY = (date) =>
    new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);

  const deliveryDays = parseInt(settings.invoiceDeliveryDays, 10) || 10;
  const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const deliveryBeforeDate = new Date(orderDate.getTime() + deliveryDays * 24 * 60 * 60 * 1000);

  // "razorpay" -> "Razorpay" -- paymentGatewayNames is Shopify's own
  // lowercase gateway identifier array, not a display-ready label.
  const paymentMode = (order.paymentGatewayNames || [])[0]
    ? order.paymentGatewayNames[0].replace(/(^|[\s_-])\w/g, (c) => c.toUpperCase()).replace(/[_-]/g, " ")
    : "—";

  // Fetched once here (moved up from below, where only the email used to
  // need it) since the PDF's own brand header now wants a logo too --
  // all three images fetched in parallel, each independently falling
  // back to null/"" rather than failing the whole send if one URL is
  // slow or broken. invoiceLogoImageUrl (Settings page) overrides the
  // shop's own Shopify logo when set.
  const shopInfo = await getShopFooterInfo(admin);
  const [logoDataUri, sealDataUri] = await Promise.all([
    fetchImageAsDataUri(settings.invoiceLogoImageUrl || shopInfo.logoUrl),
    fetchImageAsDataUri(settings.invoiceSealImageUrl),
  ]);
  // The text fallback needs its own inline styling now that the
  // template's wrapper div is unstyled (plain centering only) -- see
  // getDefaultOrderInvoiceTemplate's own comment on why nothing here
  // can rely on a <style> block/CSS class reaching the real PDF.
  const brandHeaderHtml = logoDataUri
    ? `<img src="${logoDataUri}" style="max-width:160px;max-height:80px;">`
    : `<span style="font-size:22px;font-weight:bold;color:#d97b3f;">${esc(settings.invoiceSellerLegalName || "Only Natural Gemstones")}</span>`;
  // "<br><br>" (not empty) when no seal is set -- keeps the same blank
  // vertical space above "Authorised Seal & Signatory" that the
  // original hardcoded default always had, so not configuring a seal
  // looks exactly like it did before this feature existed.
  const sealHtml = sealDataUri
    ? `<img src="${sealDataUri}" style="max-width:90px;max-height:90px;">`
    : "<br><br>";

  // Built as real per-line table rows (see buildInfoBlockRows's own
  // comment) rather than one multi-line cell per column, so the three
  // columns stay top-aligned in the real PDF even though they always
  // have different numbers of lines in practice.
  const sellerLines = [
    `<b>${esc(settings.invoiceSellerLegalName || "Only Natural Gemstones")}</b>`,
    ...(settings.invoiceSellerAddress || "").split("\n").filter(Boolean).map(esc),
    `Tel : ${esc(settings.invoiceSellerPhone || "—")}`,
    `Email : ${esc(settings.invoiceSellerEmail || "—")}`,
    `GSTIN : ${esc(settings.invoiceGstin)}`,
  ];
  const customerLines = [
    `<b>Customer Details</b>`,
    esc(customerName),
    ...formatAddressLines(order.billingAddress, { includeName: false, includePhone: false }),
    `Tel : ${esc(order.billingAddress?.phone || order.shippingAddress?.phone || "—")}`,
  ];
  const deliveryLines = [
    `Delivery Before : ${formatDateDMY(deliveryBeforeDate)}`,
    `Sales Person : ${esc(settings.invoiceSellerLegalName || "Only Natural Gemstones")}`,
    `Delivery Mode : ${esc(order.shippingLine?.title || "—")}`,
  ];
  const infoBlockRows = buildInfoBlockRows(sellerLines, customerLines, deliveryLines);

  const template = getOrderInvoiceTemplate(settings);
  const html = renderOrderInvoiceTemplate(template, {
    brand_header_html: brandHeaderHtml,
    seal_html: sealHtml,
    info_block_rows: infoBlockRows,
    invoice_number: esc(invoiceNumber),
    invoice_date: formatDateDMY(new Date()),
    order_number: esc(order.name),
    customer_name: esc(customerName),
    customer_email: esc(email),
    customer_phone: esc(order.billingAddress?.phone || order.shippingAddress?.phone || "—"),
    // includeName/includePhone: false here -- the default PDF template's
    // customer block already prints {{customer_name}} and
    // {{customer_phone}} as their own fields right next to this, so
    // including them again inside the address block itself would show
    // the same name and phone number twice (confirmed live).
    billing_address: formatAddress(order.billingAddress, { includeName: false, includePhone: false }),
    shipping_address: formatAddress(order.shippingAddress || order.billingAddress),
    seller_legal_name: esc(settings.invoiceSellerLegalName || "Only Natural Gemstones"),
    seller_address: esc(settings.invoiceSellerAddress || "").split("\n").map(esc).join("<br>"),
    seller_phone: esc(settings.invoiceSellerPhone || "—"),
    seller_email: esc(settings.invoiceSellerEmail || "—"),
    seller_gstin: esc(settings.invoiceGstin),
    sales_person: esc(settings.invoiceSellerLegalName || "Only Natural Gemstones"),
    delivery_mode: esc(order.shippingLine?.title || "—"),
    delivery_before: formatDateDMY(deliveryBeforeDate),
    payment_mode: esc(paymentMode),
    line_items_rows: gst.lineItemsRowsHtml,
    subtotal: formatMoney(gst.subtotal, gst.currency),
    total_gst: formatMoney(gst.totalGst, gst.currency),
    grand_total: formatMoney(gst.grandTotal, gst.currency),
    total_in_words: esc(totalInWords(gst.grandTotal, gst.currency)),
    tax_treatment_note: esc(gst.taxTreatmentNote),
    shop_name: esc(settings.invoiceSellerLegalName || "Only Natural Gemstones"),
    shop_url: esc(shopInfo.url),
  });

  let pdfBuffer;
  try {
    pdfBuffer = await generateInvoicePdfBuffer(html);
  } catch (err) {
    console.error("[orderInvoice] PDF generation failed:", err);
    await prisma.orderInvoice.update({
      where: { orderId: orderGid },
      data: { status: `FAILED: PDF generation error: ${err.message}`, lastSentAt: new Date() },
    });
    return `FAILED: PDF generation error: ${err.message}`;
  }

  // shopInfo was already fetched above (for the PDF's own logo) --
  // reused here rather than fetching it a second time.
  const orderStatusUrl = shopInfo.url;
  const firstName = order.customer?.firstName || customerName.split(" ")[0] || "there";

  const emailTemplate = getInvoiceEmailTemplate(settings);
  const emailHtml = renderOrderInvoiceTemplate(emailTemplate, {
    customer_first_name: esc(firstName),
    order_number: esc(order.name),
    invoice_number: esc(invoiceNumber),
    order_status_url: esc(orderStatusUrl),
    shop_name: esc(shopInfo.name),
    shop_url: esc(shopInfo.url),
    shop_email: esc(shopInfo.email),
    shop_logo_url: esc(shopInfo.logoUrl),
  });
  const emailText =
    `Hello ${firstName},\n\n` +
    `Thank you for your order ${order.name}. Your GST tax invoice ${invoiceNumber} is attached to this email as a PDF.\n\n` +
    `Best Wishes & Regards!`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  try {
    await transporter.sendMail({
      from: `"${settings.invoiceSellerLegalName || "Only Natural Gemstones"}" <${settings.gmailUser}>`,
      to: email,
      subject: `Invoice ${invoiceNumber} for your order ${order.name}`,
      text: emailText,
      html: emailHtml,
      attachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    console.error("[orderInvoice] Email send failed:", err);
    await prisma.orderInvoice.update({
      where: { orderId: orderGid },
      data: { status: `FAILED: email send error: ${err.message}`, lastSentAt: new Date() },
    });
    return `FAILED: email send error: ${err.message}`;
  }

  await prisma.orderInvoice.update({
    where: { orderId: orderGid },
    data: { status: `OK: sent to ${email}`, sentTo: email, lastSentAt: new Date() },
  });

  return `OK: sent to ${email}`;
}
