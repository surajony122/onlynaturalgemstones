/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/astro-advice
 *
 * CLOSED. This used to save a gem-recommendation lead (and send the customer email / WhatsApp and the team alert) straight from
 * whatever was posted, with NO one-time code check. The recommendation form no longer posts here: it uses
 *   /apps/customize/gem-advice-otp-request   (sends the code)
 *   /apps/customize/gem-advice-otp-verify    (checks the code, calculates the chart on the server, saves the lead)
 * The form's "apps script URL" setting still holds this address, but only as the base the two addresses above are built from.
 *
 * It is kept as a route (instead of deleted) so anything still pointing here gets a clear, harmless answer.
 */
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  return Response.json(
    { ok: false, error: "This address is no longer used. Please submit the form on the website." },
    { status: 410 },
  );
};

export const loader = async () => Response.json({ ok: false, error: "Not found" }, { status: 404 });
