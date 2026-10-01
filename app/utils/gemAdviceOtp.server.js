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

/** Emails the 4-digit code via the same Gmail/Nodemailer setup used for
 * the recommendation email itself (astroAdvice.server.js). Returns a
 * short status string, never throws — callers treat a thrown/rejected
 * send as a delivery failure to fall back on, same as every other
 * best-effort send in this app. */
export async function sendGemAdviceOtpEmail(settings, { email, name, code }) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    return "skipped: Gmail user / app password not set";
  }

  const firstName = (name || "").split(" ")[0] || "there";
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  await transporter.sendMail({
    from: '"Only Natural Gemstones" <' + settings.gmailUser + ">",
    to: email,
    subject: "Your verification code: " + code,
    text:
      "Hi " + firstName + ",\n\n" +
      "Your Only Natural Gemstones verification code is " + code + ".\n" +
      "This code expires in 10 minutes. Do not share it with anyone.\n\n" +
      "Only Natural Gemstones",
    html:
      "<p>Hi " + firstName + ",</p>" +
      "<p>Your Only Natural Gemstones verification code is <strong style=\"font-size:20px;letter-spacing:2px;\">" + code + "</strong>.</p>" +
      "<p>This code expires in 10 minutes. Do not share it with anyone.</p>" +
      "<p>Only Natural Gemstones</p>",
  });

  return "OK: sent to " + email;
}
