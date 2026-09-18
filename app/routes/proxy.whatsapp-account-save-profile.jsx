/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-account-save-profile
 *
 * Saves the WhatsApp-OTP account page's Profile tab — updates the
 * customer's name/email if a Shopify customer record already exists for
 * this phone, or creates one (seeded with this phone) if this is the
 * very first time this phone-verified visitor has saved anything. Real
 * edit capability, unlike the Customer Account Hub extension's
 * read-only Profile tab — that one can only navigate to Shopify's own
 * native edit page (a platform limit of Customer Account UI
 * Extensions); this is a plain custom page with full Admin API access.
 *
 * Request body (JSON): { token, firstName, lastName, email }
 * Response (JSON): { ok: true, profile } or { ok: false, error }
 */
import { authenticate } from "../shopify.server";
import { findCustomerGidByPhone, saveCustomerProfile } from "../utils/customerAccountData.server";
import { resolvePhoneFromToken } from "../utils/whatsappOtpAuth.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session?.shop) {
    return Response.json({ ok: false, error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const phone = await resolvePhoneFromToken(data.token);
  if (!phone) {
    return Response.json({ ok: false, error: "Session expired. Please log in again." }, { status: 401 });
  }

  try {
    const customerGid = await findCustomerGidByPhone(admin, phone);
    const result = await saveCustomerProfile(admin, {
      customerGid,
      phone,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
    });
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.whatsapp-account-save-profile] unhandled error:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
};
