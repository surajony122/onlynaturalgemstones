// Does a lead's email / WhatsApp status mean "this message never went out, so retrying makes sense"?
// Shared by the lead pages (to show Retry buttons) and their bulk-retry actions (to pick what to resend).
//
// Retry makes sense for: failed sends, "skipped" for a reason that can change (Gmail not set, a cooldown, a
// WhatsApp refusal), and a send stuck on "processing" for more than 15 minutes.
// It makes no sense for: nothing attempted yet, already sent, still pending, a lead that was replaced by a newer
// save, an emptied wishlist, a lead with no email / no phone, or an astro calculation that failed.
export function leadNeedsRetry(statusText, createdAt) {
  const t = String(statusText || "").trim();
  if (!t) return false;
  if (/^(OK|sent)/i.test(t)) return false;
  if (/^pending/i.test(t)) return false;
  if (/^processing/i.test(t)) return Date.now() - new Date(createdAt).getTime() > 15 * 60 * 1000;
  if (/superseded|emptied|ignored|no email on lead|no phone on lead|has no email|empty|calculation failed/i.test(t)) return false;
  return true;
}
