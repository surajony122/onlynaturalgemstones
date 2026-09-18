/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-account-save-address
 *
 * Creates or updates one address on the WhatsApp-OTP account page's
 * Address tab (addressId present = update, absent = create). If this
 * phone has no Shopify customer record yet, one is created first
 * (bare, seeded with just the phone) so the address has somewhere to
 * attach to — same "first save creates the customer" pattern as
 * proxy.whatsapp-account-save-profile.jsx.
 *
 * Request body (JSON): { token, addressId?, address1, address2, city,
 *                         province, zip, country, setDefault }
 * Response (JSON): { ok: true } or { ok: false, error }
 */
import { authenticate } from "../shopify.server";
import { findCustomerGidByPhone, saveCustomerAddress, saveCustomerProfile } from "../utils/customerAccountData.server";
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
    let customerGid = await findCustomerGidByPhone(admin, phone);
    if (!customerGid) {
      const created = await saveCustomerProfile(admin, { customerGid: null, phone });
      if (!created.ok) {
        return Response.json({ ok: false, error: created.error });
      }
      customerGid = created.customerGid;
    }

    const result = await saveCustomerAddress(
      admin,
      customerGid,
      {
        addressId: data.addressId || null,
        address1: data.address1,
        address2: data.address2,
        city: data.city,
        province: data.province,
        zip: data.zip,
        country: data.country,
      },
      { setDefault: !!data.setDefault }
    );
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.whatsapp-account-save-address] unhandled error:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
};
