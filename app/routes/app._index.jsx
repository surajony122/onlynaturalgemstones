/**
 * "/app" is where Shopify opens the app, so it lands on the Overview
 * dashboard. The jewelry pricing screen that used to live here is now at
 * /app/pricing (app.pricing.jsx). The query string is kept on the redirect
 * because it carries the embedded-app session parameters (host, shop, ...).
 */
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  return redirect("/app/overview" + url.search);
};

export default function AppIndex() {
  return null;
}
