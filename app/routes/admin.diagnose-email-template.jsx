/**
 * One-off check: confirm the orderProcessingEmailTemplate migration
 * landed cleanly and the default template renders. NOT a permanent
 * standing endpoint -- delete this file once confirmed.
 *
 *   GET /admin/diagnose-email-template?secret=<DIAG_SECRET>
 */
import db from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";
import { getOrderProcessingEmailTemplate, renderOrderProcessingEmailTemplate } from "../utils/orderProcessingEmail.server";

const DIAG_SECRET = "7a1f3e9b2c4d6058b7e9f1a3c5d7e9f0b1a2c3d4e5f60729";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== DIAG_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ error: "No shop installed" }, { status: 500 });
  }

  const settings = await getAppSettings(session.shop);
  const template = getOrderProcessingEmailTemplate(settings);
  const trueDefault = getOrderProcessingEmailTemplate({});
  const rendered = renderOrderProcessingEmailTemplate(template, {
    customer_first_name: "Test User",
    order_number: "#TEST1234",
    order_status_url: "https://example.com/status",
    shop_name: "Only Natural Gemstones",
    shop_url: "https://onlynaturalgemstones.com",
    shop_email: "info@onlynaturalgemstones.com",
    shop_logo_url: "https://example.com/logo.png",
  });

  return Response.json({
    migrationOk: true,
    hasCustomTemplateRawValue: settings.orderProcessingEmailTemplate ? settings.orderProcessingEmailTemplate.slice(0, 80) : null,
    templateLength: template.length,
    trueDefaultLength: trueDefault.length,
    identicalToDefault: template === trueDefault,
    renderedHasPlaceholders: rendered.includes("{{"),
  });
};
