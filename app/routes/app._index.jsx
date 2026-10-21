/**
 * "/app" is where Shopify opens the app, so it lands on the Overview
 * dashboard. The jewelry pricing screen that used to live here is now at
 * /app/pricing (app.pricing.jsx). The query string is kept on the redirect
 * because it carries the embedded-app session parameters (host, shop, ...).
 */
import { redirect } from "react-router";
import { authenticatePage } from "../utils/teamAccess.server";

export const loader = async ({ request }) => {
  const { access } = await authenticatePage(request, null);
  const url = new URL(request.url);
  const order = [["overview", "/app/overview"], ["astro", "/app/astro-leads"], ["wishlist", "/app/wishlist-leads"], ["contact", "/app/contact-leads"], ["invoices", "/app/invoices"], ["pricing", "/app/pricing"], ["gemdetails", "/app/gemstone-details"], ["currency", "/app/currency-countries"], ["designimages", "/app/design-images"], ["whatsapp", "/app/whatsapp-events"], ["documentation", "/app/documentation"]];
  const first = order.find(([id]) => access.canOpen(id));
  return redirect((first ? first[1] : "/app/no-access") + url.search);
};

export default function AppIndex() {
  return null;
}
