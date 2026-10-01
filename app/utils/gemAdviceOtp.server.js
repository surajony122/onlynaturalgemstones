/**
 * Server-side OTP generation/verification for the storefront's Gem
 * Recommendation ("Astro Advice") form — see proxy.gem-advice-otp-
 * request.jsx, proxy.gem-advice-otp-verify.jsx. Modeled directly on
 * whatsappOtpAuth.server.js's proven pattern (rate limits, attempt
 * caps, server-side-only comparison), kept as its own module/table
 * instead of reusing that one because this form verifies a phone AND
 * an email together in one step, with a 4-digit code instead of 6.
 *
 * Replaces the form's previous OTP flow, which generated and verified
 * the code entirely in the browser (Math.random(), compared against a
 * JS variable) and never actually delivered it anywhere — the "send"
 * request went to a route that silently ignored it. This module is the
 * real, server-side source of truth.
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { esc, getShopFooterInfo } from "./astroAdvice.server";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

function generateFourDigitCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

/** Creates a new 4-digit OTP code for this phone+email pair (after
 * rate-limit checks) and returns it for the caller to send via
 * WhatsApp/Email — this module never sends anything itself. */
export async function createGemAdviceOtpCode(shop, phone, email) {
  if (!phone && !email) {
    return { ok: false, error: "A phone number or email is required." };
  }

  const recent = await prisma.gemAdviceOtpCode.findFirst({
    where: { phone: phone || undefined, email: email || undefined },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, error: "Please wait a moment before requesting another code." };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sentThisHour = await prisma.gemAdviceOtpCode.count({
    where: { phone: phone || undefined, email: email || undefined, createdAt: { gte: oneHourAgo } },
  });
  if (sentThisHour >= OTP_MAX_SENDS_PER_HOUR) {
    return { ok: false, error: "Too many code requests. Please try again later." };
  }

  const code = generateFourDigitCode();
  await prisma.gemAdviceOtpCode.create({
    data: { shop, phone: phone || null, email: email || null, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  return { ok: true, code };
}

/** Verifies a submitted code against this phone+email pair's latest
 * unused, unexpired code. Never throws — always returns a {ok, ...}
 * shape the route can pass straight through. */
export async function verifyGemAdviceOtpCode(shop, phone, email, submittedCode) {
  if (!phone && !email) {
    return { ok: false, error: "A phone number or email is required." };
  }

  const latest = await prisma.gemAdviceOtpCode.findFirst({
    where: { phone: phone || undefined, email: email || undefined, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || latest.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Code expired or not found. Please request a new one." };
  }
  if (latest.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  if (String(submittedCode || "").trim() !== latest.code) {
    await prisma.gemAdviceOtpCode.update({ where: { id: latest.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "Incorrect code." };
  }

  await prisma.gemAdviceOtpCode.update({ where: { id: latest.id }, data: { usedAt: new Date() } });
  return { ok: true };
}

/** Builds the OTP email's HTML — same palette/typography/footer as the
 * gem recommendation email (astroAdvice.server.js's default template)
 * so this reads as the same brand, not a bare system notice. Built
 * standalone rather than sharing that template's actual markup since
 * this one has no stone cards, results link, or Settings-page editing
 * need — just a code. */
function buildOtpEmailHtml({ firstName, code, shopInfo }) {
  const digits = String(code).split("").map((d) =>
    '<td style="width:48px;height:56px;border:1px solid #c8944a;border-radius:6px;background:#fffcf5;' +
    'font-family:\'Courier New\', Courier, monospace;font-size:28px;font-weight:700;color:#312c24;text-align:center;vertical-align:middle;box-shadow:0 2px 4px rgba(200,148,74,0.12);" align="center">' +
    esc(d) + "</td>"
  ).join('<td style="width:10px;"></td>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verify your details</title>
<style>
  body { margin:0; padding:0; width:100%; background-color:#f3f2ef; font-family:Arial, Helvetica, sans-serif; color:#4f5965; }
  table { border-spacing:0; border-collapse:collapse; }
  img { border:0; display:block; }
  a { text-decoration:none; }
  @media only screen and (max-width:600px) {
    .email-container { width:100% !important; max-width:100% !important; border-radius:0 !important; }
    .logo-section img { max-width:120px !important; }
  }
</style>
</head>
<body>
  <table class="email-wrapper" width="100%" style="background-color:#f3f2ef;">
    <tr>
      <td align="center" style="padding:32px 0;">
        <table class="email-container" width="500" style="width:500px;max-width:500px;background-color:#ffffff;border-radius:0 0 12px 12px;overflow:hidden;">
          <tr>
            <td class="logo-section" style="padding:28px 20px 25px;text-align:center;background-color:#fffcf3;border-top:5px solid #8c7a4e;">
              <img src="${esc(shopInfo.logoUrl)}" alt="${esc(shopInfo.name)}" style="max-width:140px;width:auto;height:auto;margin:0 auto;">
            </td>
          </tr>
          <tr><td style="height:1px;background-color:#d5d0c8;font-size:1px;line-height:1px;">&nbsp;</td></tr>
          <tr>
            <td style="padding:34px 28px 8px;font-size:15px;line-height:1.6;color:#4f5965;background-color:#ffffff;text-align:center;">
              <p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#3a2408;">Verify your mobile &amp; email</p>
              <p style="margin:0 0 24px;">Hi ${esc(firstName)}, here's the code to confirm your details and get your personalised gemstone recommendation.</p>
              <table align="center" style="margin:0 auto 20px;">
                <tr>${digits}</tr>
              </table>
              <p style="margin:0 0 4px;font-size:13px;color:#8c7a4e;font-weight:600;">This code expires in 10 minutes.</p>
              <p style="margin:0 0 28px;font-size:13px;color:#8a8278;">Didn't request this? You can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="background:#faf6f0;padding:24px 32px;text-align:center;border-top:1px solid #eadfd2;">
              <p style="margin:0 0 4px;font-size:12px;color:#5c4a3d;"><strong>${esc(shopInfo.name)}</strong>${shopInfo.addressLine ? ", " + esc(shopInfo.addressLine) : ""}</p>
              <p style="margin:0;font-size:12px;color:#8c7a4e;">
                <a href="${esc(shopInfo.url)}" style="color:#8c7a4e;">${esc(shopInfo.url.replace(/^https?:\/\//, ""))}</a>
                &nbsp;&middot;&nbsp;
                <a href="mailto:${esc(shopInfo.email)}" style="color:#8c7a4e;">${esc(shopInfo.email)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Emails the 4-digit code via the same Gmail/Nodemailer setup used for
 * the recommendation email itself (astroAdvice.server.js), styled to
 * match that same brand template instead of being a bare-text notice.
 * Returns a short status string, never throws — callers treat a
 * thrown/rejected send as a delivery failure to fall back on, same as
 * every other best-effort send in this app. */
export async function sendGemAdviceOtpEmail(admin, settings, { email, name, code }) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail user / app password not set";
  }

  const firstName = (name || "").split(" ")[0] || "there";
  const shopInfo = await getShopFooterInfo(admin);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verification Code</title>
    </head>
    <body style="margin:0; padding:0; background-color:#f4f2ed; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#312c24;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout:fixed; background-color:#f4f2ed; padding: 40px 16px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:540px; background-color:#ffffff; border:1px solid #e2d9cc; border-radius:8px; overflow:hidden; box-shadow:0 4px 16px rgba(49,44,36,0.06);">
              <!-- Top Brass Accent Bar -->
              <tr>
                <td style="height:5px; background:linear-gradient(90deg, #8c7a4e, #c8944a, #8c7a4e);"></td>
              </tr>
              <!-- Inner Content -->
              <tr>
                <td style="padding:36px 32px 32px 32px; text-align:center;">
                  <!-- Header Brand Title -->
                  <h1 style="margin:0 0 4px 0; font-family:Georgia, 'Times New Roman', serif; font-size:22px; font-weight:bold; color:#312c24; text-transform:uppercase; letter-spacing:2.5px;">ONLY NATURAL GEMSTONES</h1>
                  <p style="margin:0 0 24px 0; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:3px; color:#8c7a4e;">AUTHENTIC &amp; VEDIC GEMSTONES</p>
                  
                  <hr style="border:none; border-top:1px solid #efeae4; margin:0 0 24px 0;" />
                  
                  <!-- Greeting & Instruction -->
                  <p style="font-size:15px; color:#312c24; line-height:1.6; margin:0 0 12px 0; text-align:left;">Hi <strong>${firstName}</strong>,</p>
                  <p style="font-size:14px; color:#5c5244; line-height:1.6; margin:0 0 24px 0; text-align:left;">Use the verification code below to validate your request for your <strong>Gemstone Recommendation</strong>:</p>
                  
                  <!-- OTP Code Box (4 Individual Digit Cards) -->
                  <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                    <tr>
                      ${String(code).split("").map(d => `
                        <td style="width:48px; height:56px; border:1px solid #c8944a; border-radius:6px; background:#fffcf5; font-family:'Courier New', Courier, monospace; font-size:28px; font-weight:700; color:#312c24; text-align:center; vertical-align:middle; box-shadow:0 2px 4px rgba(200,148,74,0.12);" align="center">${d}</td>
                      `).join('<td style="width:10px;"></td>')}
                    </tr>
                  </table>
                  
                  <!-- Expiry / Security Note -->
                  <p style="font-size:13px; color:#8c7a4e; line-height:1.5; margin:0 0 28px 0; text-align:center;">
                    ⏱️ This verification code will expire in <strong>10 minutes</strong>.<br />
                    <span style="font-size:12px; color:#887c69;">Do not share this code with anyone for security purposes.</span>
                  </p>
                  
                  <hr style="border:none; border-top:1px solid #efeae4; margin:0 0 20px 0;" />
                  
                  <!-- Footer -->
                  <p style="font-size:12px; color:#766852; margin:0 0 4px 0; text-align:center;">Warm regards,<br /><strong>Team Only Natural Gemstones</strong></p>
                  <p style="font-size:11px; color:#a39580; margin:0; text-align:center;"><a href="https://www.shubhgems.com" style="color:#c8944a; text-decoration:none; font-weight:bold;">www.shubhgems.com</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  await transporter.sendMail({
    from: '"' + shopInfo.name + '" <' + settings.gmailUser + ">",
    to: email,
    subject: "Verify your details to get your gemstone recommendation",
    text:
      "Hi " + firstName + ",\n\n" +
      "Here's your verification code to confirm your mobile number and email for your personalised gemstone recommendation: " + code + "\n\n" +
      "This code expires in 10 minutes. Didn't request this? You can safely ignore this email.\n\n" +
      shopInfo.name,
    html: buildOtpEmailHtml({ firstName, code, shopInfo }),
  });

  return "OK: sent to " + email;
}
