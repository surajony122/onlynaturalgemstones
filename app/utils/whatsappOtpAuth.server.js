/**
 * Core OTP generation/verification/session logic for the storefront's
 * separate "My Account" page (see proxy.whatsapp-otp-request.jsx,
 * proxy.whatsapp-otp-verify.jsx, proxy.whatsapp-account-data.jsx) —
 * built because this store's Grow plan has no Shopify Plus Multipass to
 * bridge a third-party login into a real Shopify customer session, so
 * this is a fully separate, parallel login system gated purely by "can
 * this phone number receive and read back this code" (same trust model
 * as any SMS-OTP login).
 */
import crypto from "node:crypto";
import prisma from "../db.server";
import { splitPhoneForInterakt } from "./interakt.server";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes, matches the approved template's own "expires in 10 minutes" wording
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // don't let a customer (or a script) fire a second send within a minute of the last
const OTP_MAX_SENDS_PER_HOUR = 5; // per phone number — caps Interakt spend/abuse from one number
const OTP_MAX_VERIFY_ATTEMPTS = 5; // per code — blocks brute-forcing a 6-digit space within its 10-minute window
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — a "stay signed in" style session, not a short one

/** Normalizes a phone number to one canonical "+<countrycode><number>"
 * string, reusing the exact same country-code splitting
 * splitPhoneForInterakt already does for sending — so a phone typed as
 * "9876543210", "+919876543210", or "09876543210" all resolve to the
 * same stored/looked-up value. Returns null for anything too
 * short/malformed to confidently normalize. */
export function normalizePhone(phone) {
  const split = splitPhoneForInterakt(phone);
  return split ? `${split.countryCode}${split.phoneNumber}` : null;
}

function generateSixDigitCode() {
  // 0-padded so it's always exactly 6 characters, including a value like "004821".
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Creates a new OTP code for this phone (after rate-limit checks) and
 * returns it for the caller to send via WhatsApp — this module never
 * sends anything itself, keeping it independent of Interakt/any specific
 * delivery channel. */
export async function createOtpCode(shop, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: "Enter a valid phone number." };
  }

  const recent = await prisma.whatsAppOtpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, error: "Please wait a moment before requesting another code." };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sentThisHour = await prisma.whatsAppOtpCode.count({
    where: { phone, createdAt: { gte: oneHourAgo } },
  });
  if (sentThisHour >= OTP_MAX_SENDS_PER_HOUR) {
    return { ok: false, error: "Too many code requests for this number. Please try again later." };
  }

  const code = generateSixDigitCode();
  await prisma.whatsAppOtpCode.create({
    data: { shop, phone, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  return { ok: true, phone, code };
}

/** Verifies a code against the phone's latest sent (unused, unexpired)
 * code, issuing a new session token on success. Never throws — always
 * returns a {ok, ...} shape the route can pass straight through. */
export async function verifyOtpCode(shop, rawPhone, submittedCode) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: "Enter a valid phone number." };
  }

  const latest = await prisma.whatsAppOtpCode.findFirst({
    where: { phone, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || latest.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Code expired or not found. Please request a new one." };
  }
  if (latest.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  if (String(submittedCode || "").trim() !== latest.code) {
    await prisma.whatsAppOtpCode.update({ where: { id: latest.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "Incorrect code." };
  }

  await prisma.whatsAppOtpCode.update({ where: { id: latest.id }, data: { usedAt: new Date() } });

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.whatsAppAccountSession.create({
    data: { shop, phone, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });

  return { ok: true, token, phone };
}

/** Resolves a session token back to the phone number it belongs to, or
 * null if it's missing/expired/unrecognized. Session rows are never
 * deleted on expiry (kept for the same audit-trail reasons every other
 * table in this app is append-only) — an expired one is just treated as
 * invalid here. */
export async function resolvePhoneFromToken(token) {
  if (!token) return null;
  const session = await prisma.whatsAppAccountSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.phone;
}
