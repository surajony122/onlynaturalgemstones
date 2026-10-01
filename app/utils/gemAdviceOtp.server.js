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

  const shopName = esc(shopInfo?.name || "Only Natural Gemstones");
  const shopUrl = esc(shopInfo?.url || "https://onlynaturalgemstones.com");
  const shopEmail = esc(shopInfo?.email || "info@onlynaturalgemstones.com");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your verification code: ${esc(code)}</title>
<style type="text/css">
  body {
    margin: 0;
    padding: 0;
    width: 100%;
    background-color: #f3f2ef;
    font-family: Arial, Helvetica, sans-serif;
    color: #4f5965;
  }
  table {
    border-spacing: 0;
    border-collapse: collapse;
  }
  img {
    border: 0;
    display: block;
  }
  a {
    text-decoration: none;
  }
  .email-wrapper {
    width: 100%;
    background-color: #f3f2ef;
  }
  .page-padding {
    padding: 32px 0;
  }
  .email-container {
    width: 500px;
    max-width: 500px;
    background-color: #ffffff;
    border-radius: 0 0 12px 12px;
    overflow: hidden;
  }
  .logo-section {
    padding: 28px 20px 25px;
    text-align: center;
    background-color: #fffcf3;
    border-top: 5px solid #8c7a4e;
  }
  .logo-section img {
    max-width: 180px;
    width: auto;
    height: auto;
    margin: 0 auto;
  }
  .divider-cell {
    padding-left: 0;
    padding-right: 0;
  }
  .divider {
    height: 1px;
    background-color: #d5d0c8;
    width: 100%;
    font-size: 1px;
    line-height: 1px;
  }
  .content-section {
    padding: 30px 28px 25px;
    font-size: 15px;
    line-height: 1.6;
    color: #4f5965;
    background-color: #ffffff;
    text-align: center;
  }
  .footer-section {
    padding: 14px 18px 16px;
    text-align: center;
    color: #4f5965;
    background-color: #fffcf3;
  }
  .footer-title {
    margin: 0 0 8px;
    font-size: 14px;
    line-height: 1.45;
    color: #4f5965;
  }
  .address {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.45;
    color: #333333 !important;
  }
  .address a {
    color: #333333 !important;
    text-decoration: none !important;
  }
  .contact-table {
    width: 100%;
    margin: 0 auto;
    table-layout: fixed;
  }
  .website-row {
    padding-bottom: 8px;
  }
  .contact-item {
    width: 50%;
    padding: 3px 2px;
    text-align: center;
    vertical-align: middle;
    font-size: 13px;
    line-height: 18px;
  }
  .single-contact-item {
    padding: 3px 2px;
    text-align: center;
    vertical-align: middle;
    font-size: 13px;
    line-height: 18px;
  }
  .contact-link {
    color: #333333 !important;
    text-decoration: none !important;
    white-space: nowrap;
  }
  .contact-icon {
    width: 18px;
    height: 18px;
    display: block;
  }
  @media only screen and (max-width: 600px) {
    .page-padding {
      padding: 0 !important;
    }
    .email-container {
      width: 100% !important;
      max-width: 100% !important;
      border-radius: 0 !important;
    }
    .logo-section {
      padding: 22px 15px !important;
    }
    .logo-section img {
      max-width: 120px !important;
    }
    .content-section {
      padding: 24px 20px 18px !important;
      font-size: 16px !important;
    }
    .footer-section {
      padding: 12px 12px 14px !important;
    }
    .footer-title {
      font-size: 14px !important;
      line-height: 1.4 !important;
      margin-bottom: 7px !important;
    }
    .address {
      font-size: 13px !important;
      line-height: 1.4 !important;
      margin-bottom: 8px !important;
    }
    .website-row {
      padding-bottom: 6px !important;
    }
    .contact-item,
    .single-contact-item {
      padding: 3px 1px !important;
      font-size: 13px !important;
    }
    .contact-link {
      white-space: nowrap !important;
    }
  }
</style>
</head>
<body>
  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td class="page-padding" align="center">
        <table class="email-container" width="500" cellpadding="0" cellspacing="0" border="0">
          <!-- LOGO HEADER -->
          <tr>
            <td class="logo-section">
              <img src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/ong-logo-house-of-shubh-gems.png?v=1788589827" alt="${shopName}" style="max-width:180px;width:auto;height:auto;margin:0 auto;display:block;">
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <!-- CONTENT -->
          <tr>
            <td class="content-section">
              <p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#3a2408;">Verify your mobile &amp; email</p>
              <p style="margin:0 0 24px;">Hi ${esc(firstName)}, here's the code to confirm your details and get your personalised gemstone recommendation.</p>
              <table align="center" style="margin:0 auto 20px;">
                <tr>${digits}</tr>
              </table>
              <p style="margin:0 0 4px;font-size:13px;color:#8c7a4e;font-weight:600;">⏱️ This code expires in 10 minutes.</p>
              <p style="margin:0;font-size:13px;color:#8a8278;">Didn't request this? You can safely ignore this email.</p>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td class="divider-cell">
              <div class="divider">&nbsp;</div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="footer-section">

              <p class="footer-title">
                Thanks for choosing ${shopName} from the House of ONG.
              </p>

              <p class="address">
                <a href="https://maps.app.goo.gl/vffRkrDyMiM9q895A">
                  L-75-76, Lajpat Nagar 2, New Delhi - Delhi - 110024, India
                </a>
              </p>

              <!-- WEBSITE -->
              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >
                <tr>
                  <td
                    class="single-contact-item website-row"
                    align="center"
                  >
                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >
                      <tr>
                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >
                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/website.png?v=1788870868"
                            alt="Website"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >
                        </td>
                        <td valign="middle">
                          <a
                            href="${shopUrl}"
                            class="contact-link"
                          >
                            onlynaturalgemstones.com
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- WHATSAPP AND PHONE -->
              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >
                <tr>
                  <!-- WHATSAPP -->
                  <td
                    class="contact-item"
                    align="center"
                  >
                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >
                      <tr>
                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >
                          <a href="https://wa.me/919310400152">
                            <img
                              src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358"
                              alt="WhatsApp"
                              width="18"
                              height="18"
                              class="contact-icon"
                            >
                          </a>
                        </td>
                        <td valign="middle">
                          <a
                            href="https://wa.me/919310400152"
                            class="contact-link"
                          >
                            +91-9310-400-152
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- PHONE -->
                  <td
                    class="contact-item"
                    align="center"
                  >
                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >
                      <tr>
                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >
                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346"
                            alt="Phone"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >
                        </td>
                        <td valign="middle">
                          <a
                            href="tel:+918010555111"
                            class="contact-link"
                          >
                            +91-8010-555-111
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- EMAIL -->
              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >
                <tr>
                  <td
                    class="single-contact-item"
                    align="center"
                  >
                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >
                      <tr>
                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >
                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/email_icon_24px.png?v=1790236665"
                            alt="Email"
                            width="18"
                            class="contact-icon"
                          >
                        </td>
                        <td valign="middle">
                          <a
                            href="mailto:${shopEmail}"
                            class="contact-link"
                          >
                            ${shopEmail}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

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

  const htmlContent = buildOtpEmailHtml({ firstName, code, shopInfo });

  await transporter.sendMail({
    from: '"' + shopInfo.name + '" <' + settings.gmailUser + ">",
    to: email,
    subject: "Your verification code: " + code,
    text:
      "Hi " + firstName + ",\n\n" +
      "Your verification code is " + code + ".\n\n" +
      "This code expires in 10 minutes. Do not share it with anyone.\n\n" +
      shopInfo.name,
    html: htmlContent,
  });

  return "OK: sent to " + email;
}
