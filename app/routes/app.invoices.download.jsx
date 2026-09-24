/**
 * "Download PDF" button on the Invoices page (app.invoices.jsx) — a
 * plain GET so the browser can just navigate/download it directly
 * (window.open / <a download>), rather than needing a fetch+blob dance.
 * Same authenticate.admin(request) pattern as every other page in this
 * app (no extension sandbox, no idToken dance -- see app.invoices.jsx's
 * own header comment for why that route exists instead of the
 * order-invoice-action extension for the emailing flow).
 *
 * Reuses buildInvoicePdf (orderInvoice.server.js) -- the exact same code
 * path sendOrderInvoiceEmail calls -- so a downloaded PDF is always
 * byte-identical to one that would be emailed, never a second
 * separately-maintained build.
 */
import { authenticate } from "../shopify.server";
import { getAppSettings } from "../utils/appSettings.server";
import { buildInvoicePdf } from "../utils/orderInvoice.server";

function toOrderGid(id) {
  if (!id) return null;
  return String(id).startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const orderGid = toOrderGid(url.searchParams.get("orderId"));
  if (!orderGid) {
    return new Response("orderId is required", { status: 400 });
  }

  const settings = await getAppSettings(session.shop);

  let built;
  try {
    built = await buildInvoicePdf(admin, settings, session.shop, orderGid);
  } catch (err) {
    console.error("[app.invoices.download] failed:", err);
    return new Response(`Couldn't generate the invoice: ${String(err.message || err)}`, { status: 500 });
  }

  if (!built.ok) {
    return new Response(`Couldn't generate the invoice: ${built.error}`, { status: 422 });
  }

  return new Response(built.pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // "attachment" (not "inline") so it downloads straight away rather
      // than trying to open inside the embedded admin iframe.
      "Content-Disposition": `attachment; filename="${built.invoiceNumber}.pdf"`,
      "Content-Length": String(built.pdfBuffer.length),
    },
  });
};
