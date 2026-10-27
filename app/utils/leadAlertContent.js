/**
 * The pure parts of the team lead alert emails: reading the list of team addresses, shortening a
 * send status, and laying out the email. No database, no network, so it can be tested on its own.
 * (The sending, de-duplication and logging live in leadAlerts.server.js.)
 */

export const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "a@x.com, B@x.com; c@x.com\nnot-an-email" ->
 *   { valid: ["a@x.com","b@x.com","c@x.com"], invalid: ["not-an-email"], tooMany: false }
 * Lower-cased, de-duplicated, at most `max` valid addresses are kept.
 */
export function parseRecipients(text, max = 10) {
  const parts = String(text == null ? "" : text)
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    if (EMAIL_RE.test(p)) {
      if (!valid.includes(p)) valid.push(p);
    } else if (!invalid.includes(p)) {
      invalid.push(p);
    }
  }
  return { valid: valid.slice(0, max), invalid, tooMany: valid.length > max };
}

/** A long raw send status ("OK: sent to ..." / "FAILED: HTTP 400 ...") as one short readable phrase. */
export function shortStatus(status) {
  const s = String(status == null ? "" : status).replace(/\s+/g, " ").trim();
  if (!s) return "Not sent";
  if (/^OK/i.test(s)) return "Sent";
  if (/^skipped/i.test(s)) return s.slice(0, 100);
  return "Failed: " + s.replace(/^(failed|error)\s*:?\s*/i, "").slice(0, 100);
}

export const digitsOnly = (p) => String(p == null ? "" : p).replace(/\D/g, "");

/** IST date-time, the way the team reads it. */
export function formatIst(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
  } catch {
    return d.toISOString();
  }
}

/** Phone value with a tap-to-call and a WhatsApp link, for a row in the alert. */
export function phoneValue(phone) {
  const p = String(phone == null ? "" : phone).trim();
  if (!p) return "";
  const d = digitsOnly(p);
  if (d.length < 8) return p;
  return { text: p, links: [{ label: "Call", href: "tel:+" + d }, { label: "WhatsApp", href: "https://wa.me/" + d }] };
}

export function emailValue(email) {
  const e = String(email == null ? "" : email).trim();
  if (!e) return "";
  return { text: e, links: [{ label: "Write", href: "mailto:" + e }] };
}

const GOLD = "#8C7A4E";

/**
 * rows:  [label, value]; value is a string or { text, links: [{label, href}] }; empty values are left out.
 * items: optional list of short strings shown under `itemsTitle` (e.g. wishlist products, cart lines).
 * link:  optional { label, href } big link at the bottom (e.g. the customer's recovery link).
 * Returns { html, text }.
 */
export function buildAlertEmail({ heading, intro = "", rows = [], itemsTitle = "", items = [], link = null, footerNote = "" }) {
  const shown = rows.filter(([, v]) => v && (typeof v === "string" ? v.trim() : v.text));

  const rowHtml = shown
    .map(([label, v]) => {
      const text = typeof v === "string" ? v : v.text;
      const links = typeof v === "string" ? [] : v.links || [];
      const linkHtml = links
        .map((l) => ` <a href="${esc(l.href)}" style="color:${GOLD};font-size:12px;text-decoration:underline;">${esc(l.label)}</a>`)
        .join(" &middot;");
      return (
        `<tr><td valign="top" style="padding:7px 12px 7px 0;width:150px;font-size:12px;color:#7b8590;text-transform:uppercase;letter-spacing:0.04em;">${esc(label)}</td>` +
        `<td valign="top" style="padding:7px 0;font-size:14px;color:#2a2a2a;">${esc(text)}${linkHtml}</td></tr>`
      );
    })
    .join("");

  const itemsHtml = items.length
    ? `<div style="margin:18px 0 6px;font-size:12px;color:#7b8590;text-transform:uppercase;letter-spacing:0.04em;">${esc(itemsTitle)}</div>` +
      `<ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.6;color:#2a2a2a;">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : "";

  const linkHtml = link
    ? `<p style="margin:22px 0 0;"><a href="${esc(link.href)}" style="display:inline-block;background:${GOLD};color:#ffffff;padding:10px 20px;border-radius:3px;font-size:13px;text-decoration:none;">${esc(link.label)}</a></p>`
    : "";

  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e8;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e8e1d3;">` +
    `<tr><td style="padding:22px 26px 6px;font-family:Arial,Helvetica,sans-serif;">` +
    `<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};">Only Natural Gemstones &middot; team alert</div>` +
    `<h1 style="margin:8px 0 6px;font-size:20px;line-height:1.3;color:#2a2a2a;font-weight:600;">${esc(heading)}</h1>` +
    (intro ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#4f5965;">${esc(intro)}</p>` : "") +
    `</td></tr>` +
    `<tr><td style="padding:6px 26px 22px;font-family:Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8e1d3;">${rowHtml}</table>` +
    itemsHtml +
    linkHtml +
    (footerNote ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#7b8590;">${esc(footerNote)}</p>` : "") +
    `</td></tr></table></td></tr></table></body></html>`;

  const lines = [heading, ""];
  if (intro) lines.push(intro, "");
  for (const [label, v] of shown) lines.push(label + ": " + (typeof v === "string" ? v : v.text));
  if (items.length) lines.push("", itemsTitle + ":", ...items.map((i) => "  - " + i));
  if (link) lines.push("", link.label + ": " + link.href);
  if (footerNote) lines.push("", footerNote);

  return { html, text: lines.join("\n") };
}

// ------------------------------------------------------------------ "exact customer email" + team strip

export const APP_HANDLE = "ong-controls";

/** Link that opens a page of this app inside the Shopify admin (so staff land in the embedded app, signed in). */
export function adminAppUrl(shop, path) {
  const handle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  if (!handle) return "";
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/apps/${APP_HANDLE}/app/${String(path || "").replace(/^\/+/, "")}`;
}

/**
 * The small "team only" block that sits above a copy of the customer's email. Shows the lead's contact
 * details and a View lead button. `rows` are [label, value] pairs (value = string or {text, links}).
 */
export function buildTeamStrip({ kicker, title, rows = [], viewUrl = "", viewLabel = "View lead" }) {
  const shown = rows.filter(([, v]) => v && (typeof v === "string" ? v.trim() : v.text));
  const rowHtml = shown
    .map(([label, v]) => {
      const text = typeof v === "string" ? v : v.text;
      const links = typeof v === "string" ? [] : v.links || [];
      const linkHtml = links.map((l) => ` <a href="${esc(l.href)}" style="color:${GOLD};text-decoration:underline;">${esc(l.label)}</a>`).join(" &middot;");
      return (
        `<tr><td valign="top" style="padding:8px 10px 8px 0;width:130px;font-size:11px;color:#7b8590;text-transform:uppercase;letter-spacing:0.04em;">${esc(label)}</td>` +
        `<td valign="top" style="padding:8px 0;font-size:14px;color:#2a2a2a;">${esc(text)}${linkHtml}</td></tr>`
      );
    })
    .join("");
  const button = viewUrl
    ? `<a href="${esc(viewUrl)}" style="display:inline-block;background:${GOLD};color:#ffffff;padding:12px 28px;border-radius:4px;font-size:14px;font-weight:bold;text-decoration:none;">${esc(viewLabel)}</a>`
    : "";
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:18px 12px 6px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border:1px solid #e8e1d3;border-top:4px solid ${GOLD};border-radius:6px;"><tr><td style="padding:18px 22px;font-family:Arial,Helvetica,sans-serif;">` +
    `<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};font-weight:bold;">Team alert &middot; ${esc(kicker)}</div>` +
    `<div style="margin:6px 0 12px;font-size:20px;line-height:1.3;font-weight:bold;color:#2a2a2a;">${esc(title)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee7da;">${rowHtml}</table>` +
    (button ? `<div style="margin:16px 0 0;">${button}</div>` : "") +
    `</td></tr></table>` +
    `<div style="max-width:600px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#7b8590;text-align:center;border-bottom:1px dashed #d8cfbd;padding-bottom:10px;">&#9660; The email the customer receives &#9660;</div>` +
    `</td></tr></table>`;

  const lines = [kicker + " (team copy)", title, ""];
  for (const [label, v] of shown) lines.push(label + ": " + (typeof v === "string" ? v : v.text));
  if (viewUrl) lines.push("", viewLabel + ": " + viewUrl);
  return { html, text: lines.join("\n") };
}

/** Puts the strip straight after <body ...>, or at the very top when the email has no body tag. */
export function insertAfterBody(emailHtml, stripHtml) {
  const html = String(emailHtml || "");
  const m = /<body\b[^>]*>/i.exec(html);
  if (!m) return stripHtml + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + stripHtml + html.slice(at);
}

/**
 * The team's copy of a customer email: same layout and data, only the wording changes. Each rule is
 * [pattern, replacement]; a rule that doesn't match (e.g. a template the owner has edited) is skipped,
 * so the email still goes out, just with that sentence unchanged.
 */
export function teamizeHtml(html, rules) {
  let out = String(html || "");
  for (const [pattern, replacement] of rules) out = out.replace(pattern, () => replacement);
  return out;
}
