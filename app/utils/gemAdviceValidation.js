/**
 * Server-side checks for the gem recommendation form (the browser applies the same rules, but anything sent straight to the
 * server must be checked here too).
 *
 *   name   letters and spaces only, 1 to 25 characters
 *   email  a proper address, at most 40 characters
 *   phone  10 to 15 digits in total, country code included (the form sends e.g. +919876543210)
 *   dob    a real date, YYYY-MM-DD, not in the future, not before 1900
 *   tob    HH:MM
 *   place  at most 150 characters; lat/lon must be real coordinates
 *
 * Pure (no database, no network) so it can be tested on its own. Returns { ok: true } or { ok: false, error, field }.
 */

const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LIMITS = { nameMax: 25, emailMax: 40, phoneMin: 10, phoneMax: 15, placeMax: 150, oldestBirthYear: 1900 };

const bad = (field, error) => ({ ok: false, field, error });

export function validateGemAdviceInput(data) {
  const d = data || {};

  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name) return bad("name", "Please enter your name.");
  if (name.length > LIMITS.nameMax || !NAME_RE.test(name)) return bad("name", "Please enter your name using letters only (up to 25 characters).");

  const email = typeof d.email === "string" ? d.email.trim() : "";
  if (!email) return bad("email", "Please enter your email address.");
  if (email.length > LIMITS.emailMax) return bad("email", "Email can be up to 40 characters.");
  if (!EMAIL_RE.test(email)) return bad("email", "Please enter a valid email address.");

  const phone = typeof d.phone === "string" ? d.phone : "";
  if (!phone.trim()) return bad("phone", "Please enter your mobile number.");
  if (/[^\d\s+()\-]/.test(phone)) return bad("phone", "Please enter a valid mobile number.");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < LIMITS.phoneMin) return bad("phone", "Please enter a valid 10-digit mobile number.");
  if (digits.length > LIMITS.phoneMax) return bad("phone", "Mobile number can have at most 15 digits including the country code.");

  const dob = typeof d.dob === "string" ? d.dob : "";
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!dm) return bad("dob", "Please select date of birth.");
  const y = +dm[1], mo = +dm[2], da = +dm[3];
  const real = new Date(Date.UTC(y, mo - 1, da));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== da) return bad("dob", "Please select date of birth.");
  if (y < LIMITS.oldestBirthYear) return bad("dob", "Please select date of birth.");
  // today in the server's clock plus one day, so a visitor whose local date is already "tomorrow" (time zones) is not wrongly blocked
  if (real.getTime() > Date.now() + 24 * 60 * 60 * 1000) return bad("dob", "Date of birth cannot be in the future.");

  const tob = typeof d.tob === "string" ? d.tob : "";
  const tm = /^(\d{2}):(\d{2})$/.exec(tob);
  if (!tm || +tm[1] > 23 || +tm[2] > 59) return bad("tob", "Please select time of birth.");

  if (typeof d.placeOfBirth === "string" && d.placeOfBirth.length > LIMITS.placeMax) return bad("placeOfBirth", "Please choose your place of birth from the suggestions list.");
  if (typeof d.lat !== "number" || typeof d.lon !== "number" || !isFinite(d.lat) || !isFinite(d.lon) || Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) {
    return bad("placeOfBirth", "Please choose your place of birth from the suggestions list.");
  }

  return { ok: true };
}
