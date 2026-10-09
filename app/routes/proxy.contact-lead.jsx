/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/contact-lead
 * Called by the theme's contact form (sections/contact-form.liquid) alongside its normal
 * Shopify submit. Body (JSON): { name, email, phone, message, source, website }
 */
import { authenticate } from "../shopify.server";
import { saveContactLead } from "../utils/contactLead.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ error: "Shop not authenticated" }, { status: 401 });

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const r = await saveContactLead(session.shop, data);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  } catch (err) {
    console.error("[proxy.contact-lead] failed:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
};
