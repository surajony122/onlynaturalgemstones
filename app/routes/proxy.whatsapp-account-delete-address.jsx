/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/whatsapp-account-delete-address
 *
 * Request body (JSON): { token, addressId }
 * Response (JSON): { ok: true } or { ok: false, error }
 */
import { authenticate } from "../shopify.server";
import { deleteCustomerAddress, findCustomerGidByPhone } from "../utils/customerAccountData.server";
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
  if (!data.addressId) {
    return Response.json({ ok: false, error: "Missing addressId" }, { status: 400 });
  }

  try {
    const customerGid = await findCustomerGidByPhone(admin, phone);
    if (!customerGid) {
      return Response.json({ ok: false, error: "No customer record found." }, { status: 404 });
    }
    const result = await deleteCustomerAddress(admin, customerGid, data.addressId);
    return Response.json(result);
  } catch (err) {
    console.error("[proxy.whatsapp-account-delete-address] unhandled error:", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
};
