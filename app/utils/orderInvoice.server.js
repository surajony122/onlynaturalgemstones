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
import { esc } from "./astroAdvice.server";
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
// apart. line_items_rows and gst_breakdown_rows are pre-rendered HTML
// (a real templating loop isn't worth the added complexity/fragility for
// one page's worth of rows -- see renderOrderInvoiceTemplate's own
// comment for the same reasoning already established for the order-
// processing email template).
export const ORDER_INVOICE_PLACEHOLDERS = [
  { token: "invoice_number", description: "e.g. INV-000123 -- assigned once per order, permanently" },
  { token: "invoice_date", description: "Date the invoice was generated" },
  { token: "order_number", description: "Shopify order number, e.g. #1000031314" },
  { token: "customer_name", description: "Customer's full name" },
  { token: "customer_email", description: "Customer's email address" },
  { token: "billing_address", description: "Formatted billing address (multi-line HTML)" },
  { token: "shipping_address", description: "Formatted shipping address (multi-line HTML)" },
  { token: "seller_legal_name", description: "Your registered business name (Settings page)" },
  { token: "seller_address", description: "Your registered business address (Settings page)" },
  { token: "seller_gstin", description: "Your GSTIN (Settings page)" },
  { token: "line_items_rows", description: "Pre-built HTML table rows: item, HSN code, qty, rate, taxable value" },
  { token: "gst_breakdown_rows", description: "Pre-built HTML table rows: CGST/SGST or IGST, each with amount" },
  { token: "subtotal", description: "Sum of all line items before GST" },
  { token: "total_gst", description: "Total GST amount across all lines" },
  { token: "grand_total", description: "Subtotal + total GST" },
  { token: "tax_treatment_note", description: "\"Export — zero-rated supply under LUT\" for international orders, blank otherwise" },
  { token: "shop_name", description: "Store name" },
  { token: "shop_url", description: "Store URL" },
];

function getDefaultOrderInvoiceTemplate() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #222; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    td, th { padding: 5px 6px; }
    .header-table td { vertical-align: top; }
    .seller-block { font-size: 11px; line-height: 1.5; }
    .invoice-title { font-size: 20px; font-weight: bold; color: #8C7A4E; text-align: right; }
    .invoice-meta { text-align: right; font-size: 11px; line-height: 1.6; }
    .addr-table td { vertical-align: top; width: 50%; font-size: 11px; line-height: 1.5; }
    .addr-heading { font-weight: bold; margin-bottom: 4px; }
    .items-table th { background: #f3efe6; border: 1px solid #ccc; text-align: left; }
    .items-table td { border: 1px solid #ccc; }
    .totals-table td { border: none; }
    .totals-table .label { text-align: right; }
    .totals-table .value { text-align: right; width: 110px; }
    .grand-total { font-weight: bold; font-size: 13px; border-top: 1px solid #333; }
    .note { font-size: 10px; color: #666; margin-top: 14px; }
  </style>
</head>
<body>

  <table class="header-table">
    <tr>
      <td style="width: 55%;">
        <div class="seller-block">
          <b>{{seller_legal_name}}</b><br>
          {{seller_address}}<br>
          GSTIN: {{seller_gstin}}
        </div>
      </td>
      <td style="width: 45%;">
        <div class="invoice-title">TAX INVOICE</div>
        <div class="invoice-meta">
          Invoice #: {{invoice_number}}<br>
          Date: {{invoice_date}}<br>
          Order: {{order_number}}
        </div>
      </td>
    </tr>
  </table>

  <table class="addr-table">
    <tr>
      <td>
        <div class="addr-heading">Billed To</div>
        {{customer_name}}<br>
        {{customer_email}}<br>
        {{billing_address}}
      </td>
      <td>
        <div class="addr-heading">Shipped To</div>
        {{shipping_address}}
      </td>
    </tr>
  </table>

  <table class="items-table">
    <tr>
      <th>Item</th>
      <th>HSN</th>
      <th>Qty</th>
      <th>Taxable Value</th>
    </tr>
    {{line_items_rows}}
  </table>

  <table class="totals-table">
    <tr><td class="label">Subtotal</td><td class="value">{{subtotal}}</td></tr>
    {{gst_breakdown_rows}}
    <tr><td class="label grand-total">Grand Total</td><td class="value grand-total">{{grand_total}}</td></tr>
  </table>

  <p class="note">{{tax_treatment_note}}</p>
  <p class="note">This is a computer-generated invoice from {{shop_name}} ({{shop_url}}).</p>

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

/** Atomically assigns (or reuses) this order's invoice number. An order
 * that already has an OrderInvoice row keeps its number forever --
 * re-sending never mints a second number for the same order, which GST
 * compliance requires (invoice numbers must be sequential with no gaps
 * or reuse). A genuinely new order consumes the next number from
 * AppSettings.invoiceNextNumber (upserted starting at 1 the first time
 * this ever runs for a shop, or wherever the Settings page set it). */
export async function getOrCreateInvoiceNumber(shop, orderId, orderName) {
  const existing = await prisma.orderInvoice.findUnique({ where: { orderId } });
  if (existing) return { invoiceNumber: existing.invoiceNumber, isNew: false };

  const settingsRow = await prisma.appSettings.upsert({
    where: { shop },
    create: { shop, invoiceNextNumber: 2 },
    update: { invoiceNextNumber: { increment: 1 } },
  });
  // The row we just wrote already advanced past the number we're
  // assigning now (increment happens before we read it back on an
  // existing row) -- a fresh row's `create` above starts the counter at
  // 2, so this order gets 1. Either way, "assigned number" = the value
  // read back minus 1.
  const assignedNumber = (settingsRow.invoiceNextNumber || 2) - 1;
  const prefix = settingsRow.invoiceNumberPrefix || DEFAULT_INVOICE_NUMBER_PREFIX;
  const invoiceNumber = `${prefix}${String(assignedNumber).padStart(6, "0")}`;

  await prisma.orderInvoice.create({
    data: { shop, orderId, orderName, invoiceNumber },
  });

  return { invoiceNumber, isNew: true };
}

function formatMoney(amount, currencyCode) {
  const value = parseFloat(amount) || 0;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode || "INR", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currencyCode || ""} ${value.toFixed(2)}`;
  }
}

function formatAddress(address) {
  if (!address) return "";
  const lines = [
    address.name,
    [address.address1, address.address2].filter(Boolean).join(", "),
    [address.city, address.province, address.zip].filter(Boolean).join(", "),
    address.country,
    address.phone ? `Phone: ${address.phone}` : null,
  ].filter(Boolean);
  return lines.map(esc).join("<br>");
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
            variant {
              id
              title
              product { title }
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
  const sameState = isDomestic && sellerState && customerState && sellerState === customerState;

  const rateLoose = parseFloat(settings.invoiceGstRateLoose) || 0;
  const rateCustomisation = parseFloat(settings.invoiceGstRateCustomisation) || 0;

  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  const itemRows = [];

  for (const line of order.lineItems?.nodes || []) {
    const taxableValue = parseFloat(line.discountedTotalSet?.shopMoney?.amount ?? line.originalTotalSet?.shopMoney?.amount ?? 0) || 0;
    subtotal += taxableValue;

    const isCustomisation = line.variant?.product?.title === CUSTOMISATION_PRODUCT_TITLE;
    const rate = !isDomestic ? 0 : isCustomisation ? rateCustomisation : rateLoose;
    const gstAmount = (taxableValue * rate) / 100;

    if (isDomestic) {
      if (sameState) {
        totalCgst += gstAmount / 2;
        totalSgst += gstAmount / 2;
      } else {
        totalIgst += gstAmount;
      }
    }

    const hsn = line.variant?.inventoryItem?.harmonizedSystemCode || "";
    itemRows.push(
      `<tr><td>${esc(line.title)}</td><td>${esc(hsn)}</td><td>${line.quantity}</td><td>${formatMoney(taxableValue, currency)}</td></tr>`,
    );
  }

  const totalGst = totalCgst + totalSgst + totalIgst;
  const gstRows = [];
  if (totalCgst > 0 || totalSgst > 0) {
    gstRows.push(`<tr><td class="label">CGST</td><td class="value">${formatMoney(totalCgst, currency)}</td></tr>`);
    gstRows.push(`<tr><td class="label">SGST</td><td class="value">${formatMoney(totalSgst, currency)}</td></tr>`);
  } else if (totalIgst > 0) {
    gstRows.push(`<tr><td class="label">IGST</td><td class="value">${formatMoney(totalIgst, currency)}</td></tr>`);
  }

  return {
    currency,
    isDomestic,
    subtotal,
    totalGst,
    grandTotal: subtotal + totalGst,
    lineItemsRowsHtml: itemRows.join(""),
    gstBreakdownRowsHtml: gstRows.join(""),
    taxTreatmentNote: isDomestic ? "" : "Export — zero-rated supply under LUT (no GST charged on international orders).",
  };
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

  const template = getOrderInvoiceTemplate(settings);
  const html = renderOrderInvoiceTemplate(template, {
    invoice_number: esc(invoiceNumber),
    invoice_date: new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }),
    order_number: esc(order.name),
    customer_name: esc(customerName),
    customer_email: esc(email),
    billing_address: formatAddress(order.billingAddress),
    shipping_address: formatAddress(order.shippingAddress || order.billingAddress),
    seller_legal_name: esc(settings.invoiceSellerLegalName || "Only Natural Gemstones"),
    seller_address: esc(settings.invoiceSellerAddress || "").split("\n").map(esc).join("<br>"),
    seller_gstin: esc(settings.invoiceGstin),
    line_items_rows: gst.lineItemsRowsHtml,
    gst_breakdown_rows: gst.gstBreakdownRowsHtml,
    subtotal: formatMoney(gst.subtotal, gst.currency),
    total_gst: formatMoney(gst.totalGst, gst.currency),
    grand_total: formatMoney(gst.grandTotal, gst.currency),
    tax_treatment_note: esc(gst.taxTreatmentNote),
    shop_name: esc(settings.invoiceSellerLegalName || "Only Natural Gemstones"),
    shop_url: "https://onlynaturalgemstones.com",
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
      text: `Hello ${customerName},\n\nThank you for your business.\n\nPlease find the invoice as attachment herewith.\n\nThe Invoice ${invoiceNumber} can be viewed, printed and downloaded as PDF for further use.`,
      html: `<p>Hello ${esc(customerName)},</p><p>Thank you for your business.</p><p>Please find the invoice as attachment herewith.</p><p>The Invoice <b>${esc(invoiceNumber)}</b> can be viewed, printed and downloaded as PDF for further use.</p>`,
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
