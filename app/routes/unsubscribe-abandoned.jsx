/**
 * "Unsubscribe from cart reminders" link in the abandoned checkout email:
 *   GET /unsubscribe-abandoned?e=<email, base64url>&t=<signature>
 *
 * A resource route (no page component): it answers with a small standalone
 * HTML page. Public on purpose -- the customer opens it straight from their
 * inbox with no Shopify session. The signature stops anyone unsubscribing an
 * address they do not hold a real link for.
 */
import prisma from "../db.server";
import { readUnsubscribeLink } from "../utils/abandonedCheckoutEmail.server";

const page = (status, title, message) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title></head>` +
      `<body style="margin:0;background:#f3f2ef;font-family:Arial,Helvetica,sans-serif;color:#4f5965;">` +
      `<div style="max-width:460px;margin:60px auto;padding:34px 28px;background:#fff;border-top:5px solid #8c7a4e;border-radius:0 0 12px 12px;text-align:center;">` +
      `<h1 style="font-size:22px;font-weight:normal;color:#3d4652;margin:0 0 12px;">${title}</h1>` +
      `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;">${message}</p>` +
      `<a href="https://onlynaturalgemstones.com" style="color:#8c7a4e;">Back to Only Natural Gemstones</a>` +
      `</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const email = readUnsubscribeLink(url.searchParams.get("e"), url.searchParams.get("t"));
  if (!email) {
    return page(400, "This link is not valid", "The unsubscribe link looks incomplete or has been changed. Please use the link from your email, or reply to the email and we will remove you.");
  }
  try {
    await prisma.abandonedCheckoutOptOut.upsert({ where: { email }, update: {}, create: { email } });
  } catch (err) {
    console.error("[unsubscribe-abandoned] could not save opt-out:", err);
    return page(500, "Something went wrong", "We could not save your choice just now. Please try again in a few minutes, or reply to the email and we will remove you.");
  }
  return page(200, "You are unsubscribed", "You will no longer get cart reminder emails from us at this address.");
};
