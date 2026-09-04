/**
 * Proactive "something's wrong" email — the auto-detection half of the
 * app's health checks. runFullSystemDiagnostics() (in
 * gemstoneCustomisationMatrix.server.js) already answers "is anything
 * wrong right now"; this is what makes that answer reach a merchant who
 * hasn't opened the app, instead of only showing up as a banner the next
 * time they happen to log in. Triggered by cron.health-check.jsx (see
 * that file for the "how often" / "who calls it" setup).
 *
 * Written in plain language on purpose (see addPlainLanguage() in
 * gemstoneCustomisationMatrix.server.js) -- the audience is a merchant,
 * not a developer, and the email exists so they know to go click the
 * one button ("Fix This Now" / the app's own banner) rather than needing
 * to read a stack trace.
 */
import nodemailer from "nodemailer";

/**
 * @param {object} settings - getAppSettings(shop) result
 * @param {string} shop - "xxx.myshopify.com"
 * @param {Array} failingChecks - checks with status !== "PASS", already
 *   run through addPlainLanguage() (so each has a `.plain` field)
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendHealthAlertEmail(settings, shop, failingChecks) {
  if (!settings.gmailUser || !settings.gmailAppPassword) {
    // Same "fail quiet, don't break the caller" reasoning as the rest of
    // this app's optional integrations -- no Gmail configured means no
    // email channel to alert through, not an error worth surfacing to
    // the cron caller as a failure.
    return { sent: false, reason: "Gmail not configured in Settings" };
  }
  if (!failingChecks.length) {
    return { sent: false, reason: "Nothing to report" };
  }

  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const shopName = shop.replace(".myshopify.com", "");
  const openAppUrl = appUrl ? `${appUrl}/app` : null;

  const errorCount = failingChecks.filter((c) => c.status === "ERROR").length;
  const subject =
    errorCount > 0
      ? `⚠️ Action needed: ${errorCount === 1 ? "an issue" : `${errorCount} issues`} with your gemstone customization pricing`
      : `A quick check for your gemstone customization app`;

  const itemsHtml = failingChecks
    .map((c) => `<li style="margin-bottom:10px;">${escapeHtml(c.plain || c.message)}</li>`)
    .join("");
  const itemsPlain = failingChecks.map((c) => `- ${c.plain || c.message}`).join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b;">
      <h2 style="margin:0 0 12px;color:#991b1b;">Your gemstone customization app found ${failingChecks.length === 1 ? "an issue" : "some issues"}</h2>
      <p style="margin:0 0 16px;line-height:1.6;">Here's what's happening in plain terms:</p>
      <ul style="line-height:1.6;padding-left:20px;">${itemsHtml}</ul>
      <p style="margin:20px 0 8px;line-height:1.6;">Most of these fix in one click — open the app and look for the red "Fix This Now" button at the top.</p>
      ${openAppUrl ? `<p style="margin:20px 0;"><a href="${openAppUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Open the app</a></p>` : ""}
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">Automatic check for ${shopName} — you don't need to reply to this email.</p>
    </div>`;

  const text =
    `Your gemstone customization app found ${failingChecks.length === 1 ? "an issue" : "some issues"}:\n\n` +
    itemsPlain +
    `\n\nMost of these fix in one click -- open the app and look for the red "Fix This Now" button at the top.` +
    (openAppUrl ? `\n\nOpen the app: ${openAppUrl}` : "");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
  });

  await transporter.sendMail({
    from: `"${shopName} — Customization Health Check" <${settings.gmailUser}>`,
    to: settings.gmailUser,
    subject,
    text,
    html,
  });

  return { sent: true };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
