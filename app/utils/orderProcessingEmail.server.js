/**
 * Customer-facing "your order is being processed" email -- the email
 * counterpart to the WhatsApp order-processing notification. Shopify's
 * own native notification settings only cover Order confirmation,
 * Shipping confirmation, Delivered, and Order cancelled -- there is no
 * built-in "processing/approved" trigger to hook a Liquid template
 * into, so this app sends it directly instead, reusing the exact same
 * trigger detection already built and hardened for the WhatsApp send
 * (tag OR order-timeline "in progress" event, see
 * webhooks.orders.updated.jsx) and the merchant's already-connected
 * Gmail (Settings page) rather than inventing a new email channel.
 *
 * Content deliberately mirrors the order-confirmation email's own
 * bundle-card layout -- a gemstone + its linked "Gemstone Customisation"
 * charge line paired into one card, same rule the storefront cart
 * drawer/cart page and the order-confirmation email template all use:
 * the customisation line's hidden "_Linked Gemstone" property equals
 * its gemstone line's variant_id -- so a customer sees the same
 * familiar layout at every stage of the order, not a plain text notice.
 */
import nodemailer from "nodemailer";
import { getShopFooterInfo, esc } from "./astroAdvice.server";

// Same three CDN files the order-confirmation email template (and the
// product page's own Ring/Pendant/Bracelet type selector) already use --
// not re-uploaded, just referenced, so there's exactly one copy of each
// to ever go stale.
const TYPE_ICON_URLS = {
  ring: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/ring.png",
  pendant: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/pendant.png",
  bracelet: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/bracelet.png",
};

function getProp(line, name) {
  const found = (line.properties || []).find((p) => p && p.name === name);
  return found ? found.value : null;
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(Number(amount) || 0);
  } catch {
    return `₹${(Number(amount) || 0).toFixed(2)}`;
  }
}

// REST order-webhook line items don't carry a precomputed "final line
// price" the way the Liquid `line` drop does -- built the same way
// Shopify's own storefront does: unit price x quantity, minus whatever
// discount already landed on this specific line.
function lineTotal(line) {
  const price = parseFloat(line.price) || 0;
  const qty = Number(line.quantity) || 0;
  const discount = parseFloat(line.total_discount) || 0;
  return price * qty - discount;
}

/**
 * Best-effort image fetch for the gemstone lines -- variant image,
 * falling back to the product's featured image. Never throws: an image
 * fetch failure just means the email sends without images, same as the
 * order-confirmation template's own `{% if line.image %}` fallback --
 * nothing a customer paid for should ever be blocked by a cosmetic
 * extra.
 */
async function fetchLineImages(admin, lines) {
  const images = {};
  const withVariant = lines.filter((l) => l.variant_id);
  if (!withVariant.length) return images;

  try {
    const queryParts = withVariant.map(
      (l, i) => `v${i}: node(id: "gid://shopify/ProductVariant/${l.variant_id}") { ... on ProductVariant { image { url } product { featuredImage { url } } } }`
    );
    const res = await admin.graphql(`#graphql\nquery LineImages { ${queryParts.join(" ")} }`);
    const json = await res.json();
    withVariant.forEach((l, i) => {
      const node = json?.data?.[`v${i}`];
      const url = node?.image?.url || node?.product?.featuredImage?.url;
      if (url) images[l.variant_id] = url;
    });
  } catch (err) {
    console.error("[orderProcessingEmail] image fetch failed (non-fatal, email still sends without images):", err);
  }
  return images;
}

// One bundle "card" -- a root gemstone line, optionally paired with its
// linked Gemstone Customisation charge line -- matching
// shubh-gemstone-card.liquid's cart-drawer layout row for row (image /
// title / price, then the customisation sub-row with its own price and
// Type/Metal/Design/Size details, then a combined Total row) minus the
// Remove/Edit footer, which doesn't apply to a placed order.
function bundleCardHtml(line, custMatch, images, currency) {
  const imgUrl = images[line.variant_id];
  const combinedTotal = lineTotal(line) + (custMatch ? lineTotal(custMatch) : 0);

  let html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2dccf;border-radius:6px;margin-bottom:12px;">';

  html += "<tr>";
  html += `<td style="width:55px;padding:12px 8px 0 14px;vertical-align:top;">${
    imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(line.title)}" width="42" height="42" style="width:42px;height:42px;object-fit:cover;display:block;border:0;">` : ""
  }</td>`;
  html += `<td style="padding:14px 8px 4px;vertical-align:top;">` +
    `<div style="margin:0 0 3px;font-size:13px;color:#8C7A4E;">${esc(line.title)}</div>` +
    `<div style="font-size:10px;line-height:1.5;color:#4f5965;">` +
    (line.sku ? `SKU: ${esc(line.sku)}` : "") +
    (line.quantity ? `&nbsp;&nbsp;Qty: ${line.quantity}` : "") +
    (line.variant_title && line.variant_title !== "Default Title" ? `<br>${esc(line.variant_title)}` : "") +
    "</div></td>";
  html += `<td style="width:90px;padding:14px 14px 4px 0;text-align:right;vertical-align:top;font-size:12px;color:#4f5965;white-space:nowrap;">${formatMoney(lineTotal(line), currency)}</td>`;
  html += "</tr>";

  if (custMatch) {
    const type = (getProp(custMatch, "Customization Type") || "").toLowerCase();
    const iconUrl = TYPE_ICON_URLS[type];

    html += "<tr>";
    html += `<td style="width:55px;padding:6px 8px 0 14px;vertical-align:top;">${
      iconUrl ? `<img src="${iconUrl}" alt="${esc(type)}" width="20" height="20" style="width:20px;height:20px;object-fit:contain;display:block;border:0;">` : ""
    }</td>`;
    html += `<td style="padding:6px 8px 0;vertical-align:top;"><div style="font-size:13px;color:#8C7A4E;">Gemstone Customisation</div></td>`;
    html += `<td style="width:90px;padding:6px 14px 0 0;text-align:right;vertical-align:top;font-size:12px;color:#4f5965;white-space:nowrap;">${formatMoney(lineTotal(custMatch), currency)}</td>`;
    html += "</tr>";

    const details = [getProp(custMatch, "Customization Type"), getProp(custMatch, "Metal Type"), getProp(custMatch, "Design Code"), getProp(custMatch, "Size")]
      .filter((v) => v != null && v !== "")
      .map(esc)
      .join(" &middot; ");
    const cert = getProp(custMatch, "Lab Certification");
    html += `<tr><td></td><td colspan="2" style="padding:2px 14px 14px 8px;vertical-align:top;"><div style="font-size:10px;line-height:1.6;color:#4f5965;">${details}${
      cert ? `<br>${esc(cert)}` : ""
    }</div></td></tr>`;

    html +=
      `<tr>` +
      `<td style="border-top:1px solid #ece6d9;"></td>` +
      `<td style="padding:8px 8px 14px;text-align:left;font-size:12px;font-weight:bold;color:#3d4652;border-top:1px solid #ece6d9;">Total</td>` +
      `<td style="padding:8px 14px 14px 0;text-align:right;font-size:12px;font-weight:bold;color:#3d4652;white-space:nowrap;border-top:1px solid #ece6d9;">${formatMoney(combinedTotal, currency)}</td>` +
      `</tr>`;
  }

  html += "</table>";
  return html;
}

function buildHtml({ shopInfo, firstName, orderNumber, itemsHtml, subtotalStr, shippingStr, totalStr, storeUrl }) {
  const headerContent = shopInfo.logoUrl
    ? `<img src="${esc(shopInfo.logoUrl)}" alt="${esc(shopInfo.name)}" style="max-height:44px;max-width:220px;">`
    : `<span style="color:#3a2408;font-size:20px;font-weight:bold;letter-spacing:0.5px;">${esc(shopInfo.name)}</span>`;

  return (
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;padding:24px 0;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:600px;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(58,36,8,0.08);">' +
    '<tr><td style="background:linear-gradient(90deg,#c8944a,#8c7a4e);height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>' +
    '<tr><td style="background:#faf6f0;padding:22px 32px;text-align:center;border-bottom:1px solid #eadfd2;">' +
    headerContent +
    "</td></tr>" +
    '<tr><td style="padding:32px 32px 8px;">' +
    `<h1 style="margin:0 0 8px;font-size:21px;color:#3a2408;">Hi ${esc(firstName)},</h1>` +
    `<p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#5c4a3d;">Good news — your order <strong>${esc(orderNumber)}</strong> is now being processed and prepared for shipment.</p>` +
    '<p style="margin:0;font-size:13px;line-height:1.6;color:#8c7a4e;">We\'ll send you tracking details the moment it ships.</p>' +
    "</td></tr>" +
    '<tr><td style="padding:20px 32px 4px;">' +
    itemsHtml +
    "</td></tr>" +
    '<tr><td style="padding:4px 32px 8px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    `<tr><td style="padding:5px 0;text-align:right;font-size:12px;color:#4f5965;">Subtotal</td><td style="width:100px;padding:5px 0;text-align:right;font-size:12px;color:#4f5965;">${esc(subtotalStr)}</td></tr>` +
    `<tr><td style="padding:5px 0;text-align:right;font-size:12px;color:#4f5965;">Shipping</td><td style="width:100px;padding:5px 0;text-align:right;font-size:12px;color:#4f5965;">${esc(shippingStr)}</td></tr>` +
    `<tr><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:#3d4652;">Total</td><td style="width:100px;padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:#3d4652;">${esc(totalStr)}</td></tr>` +
    "</table>" +
    "</td></tr>" +
    '<tr><td style="padding:8px 32px 32px;">' +
    `<a href="${esc(storeUrl)}" style="display:inline-block;background:#8C7A4E;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:14px;font-weight:bold;border-radius:3px;">Continue Shopping</a>` +
    "</td></tr>" +
    '<tr><td style="background:#faf6f0;padding:24px 32px;text-align:center;border-top:1px solid #eadfd2;">' +
    `<p style="margin:0 0 14px;font-size:13px;color:#3a2408;">Thanks for choosing ${esc(shopInfo.name)}!</p>` +
    `<p style="margin:0;font-size:12px;color:#8c7a4e;"><a href="${esc(shopInfo.url)}" style="color:#8c7a4e;text-decoration:none;">${esc(shopInfo.url.replace(/^https?:\/\//, ""))}</a>` +
    ` &nbsp;&middot;&nbsp; <a href="mailto:${esc(shopInfo.email)}" style="color:#8c7a4e;text-decoration:none;">${esc(shopInfo.email)}</a>` +
    (shopInfo.phone ? ` &nbsp;&middot;&nbsp; <a href="tel:${esc(shopInfo.phone)}" style="color:#8c7a4e;text-decoration:none;">${esc(shopInfo.phone)}</a>` : "") +
    "</p>" +
    "</td></tr>" +
    "</table>" +
    "</td></tr>" +
    "</table>" +
    "</body></html>"
  );
}

/**
 * @param {object} admin - authenticated Admin GraphQL client (for the
 *   best-effort line-item image lookup)
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

  const currency = payload?.currency || "INR";
  const orderNumber = payload?.name || `#${payload?.order_number || payload?.id}`;
  const firstName = payload?.customer?.first_name || (payload?.shipping_address?.name || "").split(" ")[0] || "there";

  const lines = payload?.line_items || [];
  const rootLines = lines.filter((l) => !getProp(l, "_Linked Gemstone"));
  const matchedCustIds = new Set();
  const pairs = rootLines.map((line) => {
    const custMatch = lines.find((l) => getProp(l, "_Linked Gemstone") === String(line.variant_id)) || null;
    if (custMatch) matchedCustIds.add(custMatch.id);
    return { line, custMatch };
  });
  // Defensive, same as the order-confirmation email template: a
  // customisation line whose root gemstone wasn't found for any reason
  // still gets its own card rather than silently vanishing from what
  // the customer paid for.
  const orphanCustLines = lines.filter((l) => getProp(l, "_Linked Gemstone") && !matchedCustIds.has(l.id));

  const images = await fetchLineImages(admin, rootLines.concat(orphanCustLines));

  const itemsHtml =
    pairs.map(({ line, custMatch }) => bundleCardHtml(line, custMatch, images, currency)).join("") +
    orphanCustLines.map((line) => bundleCardHtml(line, null, images, currency)).join("");

  const shopInfo = await getShopFooterInfo(admin);

  const subtotalStr = formatMoney(payload?.subtotal_price ?? 0, currency);
  const shippingStr = formatMoney(payload?.shipping_lines?.[0]?.price ?? 0, currency);
  const totalStr = formatMoney(payload?.total_price ?? 0, currency);

  const html = buildHtml({ shopInfo, firstName, orderNumber, itemsHtml, subtotalStr, shippingStr, totalStr, storeUrl: shopInfo.url });
  const text =
    `Hi ${firstName},\n\n` +
    `Good news -- your order ${orderNumber} at ${shopInfo.name} is now being processed and prepared for shipment.\n\n` +
    `We'll send tracking details as soon as it ships.\n\n` +
    `Subtotal: ${subtotalStr}\nShipping: ${shippingStr}\nTotal: ${totalStr}\n\n` +
    shopInfo.name;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    // Same bounded timeouts as every other Gmail send in this app
    // (astroAdvice.server.js) -- an unbounded hang here would otherwise
    // be capable of stalling this webhook's response indefinitely.
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
