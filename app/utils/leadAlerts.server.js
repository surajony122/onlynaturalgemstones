/**
 * Team lead alerts (email only for now).
 *
 * When something worth following up arrives -- a gem recommendation lead, a wishlist, or an abandoned
 * checkout -- the team gets one email. Everything is OFF until it is switched on in Settings ->
 * Team lead alerts, and the team addresses are typed in there too.
 *
 *   - Every function here swallows its own errors: an alert must never break saving a lead.
 *   - LeadAlert rows are both the log shown in Settings and the "already told the team" memory, so the
 *     same thing is never alerted twice (a wishlist: once per customer per 7 days).
 *   - A safety cap (HOURLY_CAP alert emails per hour) stops a flood, e.g. from a bot filling the forms.
 *   - Sent from the same Gmail connection as the other emails (Settings -> Connections).
 */
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { getAppSettings } from "./appSettings.server";
// NOTE: abandonedCheckoutEmail.server is loaded lazily inside runAbandonedCheckoutTeamAlerts. It imports
// astroAdvice.server, which imports THIS file -- a static import here would be a circular import.
import { adminAppUrl, buildAlertEmail, buildTeamStrip, emailValue, formatIst, insertAfterBody, parseRecipients, phoneValue, shortStatus } from "./leadAlertContent";

export const HOURLY_CAP = 40;
export const WISHLIST_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHECKOUT_ALERTS_PER_RUN = 10;
const MAX_FAILED_TRIES = 3;
const CHECKOUT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const KIND_FIELD = { astro: "leadAlertAstro", wishlist: "leadAlertWishlist", checkout: "leadAlertCheckout" };

export function isAlertOn(settings, kind) {
  const field = KIND_FIELD[kind];
  return !!field && String((settings && settings[field]) || "") === "true";
}

/**
 * The team's copy of what the customer receives: the exact customer email (built by the service's own
 * template code) under a small team strip with the lead's details and a View lead button. If the exact
 * email can't be built, the plain alert (same details + the View lead button) is sent instead, so the team
 * is never left without the alert.
 */
async function teamCopy({ buildExact, strip, plain }) {
  try {
    const exact = await buildExact();
    const bar = buildTeamStrip(strip);
    return { html: insertAfterBody(exact.html, bar.html), text: bar.text + "\n\n(The customer's email is in the HTML version of this message.)" };
  } catch (err) {
    console.error("[leadAlerts] could not build the exact customer email, sending the plain alert:", err);
    return buildAlertEmail(plain);
  }
}

async function sendMailNow(settings, recipients, { subject, html, text }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: settings.gmailUser, pass: settings.gmailAppPassword },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });
  await transporter.sendMail({
    from: '"Only Natural Gemstones alerts" <' + settings.gmailUser + ">",
    to: recipients.join(", "),
    subject,
    text,
    html,
  });
}

/**
 * Sends the team one alert email and records it. Returns a short status string; never throws.
 *   kind     astro | wishlist | checkout | test
 *   refId    what it is about (used so the same thing is not alerted twice)
 *   email    { html, text }, or an async function returning that. A function only runs once the switch,
 *            de-duplication and cap checks have passed, so nothing is built (no Shopify calls) for an alert that won't send.
 *   dedupeMs 0 = never alert the same refId again; otherwise "not again within this many ms"
 *   force    skip the on/off switch, the de-duplication and the hourly cap (the Settings test button)
 */
export async function notifyTeam({ shop, settings, kind, refId, subject, email, dedupeMs = 0, force = false }) {
  try {
    const s = settings || (await getAppSettings(shop));
    if (!force && !isAlertOn(s, kind)) return "skipped: this alert is switched off";
    const { valid } = parseRecipients(s.leadAlertEmails);
    if (!valid.length) return "skipped: no team email addresses saved in Settings";
    if (!s.gmailUser || !s.gmailAppPassword) return "skipped: Gmail is not connected (Settings -> Connections)";
    const ref = String(refId == null ? "" : refId);

    if (!force && ref) {
      const since = dedupeMs > 0 ? new Date(Date.now() - dedupeMs) : null;
      const earlier = await prisma.leadAlert.findFirst({
        where: { kind, refId: ref, status: "sent", ...(since ? { createdAt: { gte: since } } : {}) },
        select: { id: true },
      });
      if (earlier) return "skipped: the team was already alerted about this";
    }

    if (!force) {
      const lastHour = await prisma.leadAlert.count({ where: { status: "sent", createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (lastHour >= HOURLY_CAP) {
        const status = `skipped: hourly limit of ${HOURLY_CAP} alert emails reached`;
        await prisma.leadAlert.create({ data: { shop: shop || null, kind, refId: ref, recipients: valid.join(", "), subject: subject || null, status } }).catch(() => {});
        return status;
      }
    }

    let status;
    try {
      const mail = typeof email === "function" ? await email() : email;
      await sendMailNow(s, valid, { subject, html: mail.html, text: mail.text });
      status = "sent";
    } catch (err) {
      status = "failed: " + String((err && err.message) || err).replace(/\s+/g, " ").slice(0, 200);
      console.error("[leadAlerts] could not send the " + kind + " alert:", err);
    }
    await prisma.leadAlert
      .create({ data: { shop: shop || null, kind, refId: ref, recipients: valid.join(", "), subject: subject || null, status } })
      .catch((e) => console.error("[leadAlerts] could not log the alert:", e));
    return status;
  } catch (err) {
    console.error("[leadAlerts] unexpected problem:", err);
    return "failed: " + String((err && err.message) || err).slice(0, 200);
  }
}

// ------------------------------------------------------------------ gem recommendation lead

/** Called once the customer's own email / WhatsApp have been attempted, so the team sees how they went. */
export async function alertGemLead({ admin, shop, settings, data, birthDetails, recommendation, trackingId, emailSendStatus, whatsappSendStatus, astroError }) {
  try {
    const saved = await prisma.astroLead.findUnique({ where: { trackingId: String(trackingId) }, select: { id: true } }).catch(() => null);
    const viewUrl = adminAppUrl(shop, saved ? "astro-leads?lead=" + encodeURIComponent(saved.id) : "astro-leads");
    const d = data || {};
    const rec = recommendation || {};
    const bd = birthDetails || {};
    const stone = (x) => (x && x.gem ? x.gem + (x.planet ? " (for " + x.planet + ")" : "") : "");
    const name = (d.name || "").trim() || d.email || d.phone || "a visitor";
    const rows = [
      ["Name", d.name || ""],
      ["Phone", phoneValue(d.phone)],
      ["Email", emailValue(d.email)],
      ["Purpose", d.purpose || ""],
      ["Date of birth", d.dob || ""],
      ["Time of birth", d.tob || ""],
      ["Place of birth", d.placeOfBirth || ""],
      ["Body weight", typeof d.bodyWeightKg === "number" ? d.bodyWeightKg + " kg" : ""],
      ["Ascendant", bd.ascendant || ""],
      ["Moon sign", bd.moonsign || ""],
      ["Life stone", stone(rec.life)],
      ["Benefic stone", stone(rec.benefic)],
      ["Lucky stone", stone(rec.lucky)],
      ["Customer email", shortStatus(emailSendStatus)],
      ["Customer WhatsApp", shortStatus(whatsappSendStatus)],
    ];
    if (astroError) rows.splice(8, 0, ["Chart", "The chart calculation FAILED for this submission. Please follow up with the customer by hand."]);
    const plain = {
      heading: "New gem recommendation lead: " + name,
      intro: "Someone just verified their code and asked for a gemstone recommendation.",
      rows,
      link: { label: "View lead", href: viewUrl },
      footerNote: "Details and status are also under Astro Leads in the ONG Controls app.",
    };
    // The exact recommendation email the customer gets needs a finished chart; without one, send the plain alert.
    const email = () =>
      astroError || !rec.life
        ? buildAlertEmail(plain)
        : teamCopy({
            buildExact: async () => (await import("./astroAdvice.server")).buildGemRecommendationEmailForTeam(admin, settings, d, bd, rec),
            strip: { kicker: "New gem recommendation lead", title: name, rows, viewUrl, viewLabel: "View lead" },
            plain,
          });
    return await notifyTeam({ shop, settings, kind: "astro", refId: trackingId, subject: "New gem recommendation lead: " + name, email });
  } catch (err) {
    console.error("[leadAlerts] gem lead alert failed:", err);
    return "failed: " + String((err && err.message) || err).slice(0, 200);
  }
}

// ------------------------------------------------------------------ wishlist

/** One alert per customer per 7 days (a wishlist can be saved many times as someone adds items). */
export async function alertWishlistLead({ admin, shop, settings, leadId, email, phone, products }) {
  try {
    const list = Array.isArray(products) ? products : [];
    if (!list.length || !email) return "skipped: empty wishlist";
    const host = shop || "";
    const items = list.slice(0, 15).map((p) => (p.title || p.handle || "Product") + (p.handle && host ? "  (https://" + host + "/products/" + p.handle + ")" : ""));
    const viewUrl = adminAppUrl(shop, leadId ? "wishlist-leads?lead=" + encodeURIComponent(leadId) : "wishlist-leads");
    const rows = [
      ["Email", emailValue(email)],
      ["Phone", phoneValue(phone)],
      ["Items saved", String(list.length)],
      ["Saved", list.slice(0, 15).map((p) => p.title || p.handle || "Product").join(", ")],
    ];
    const plain = {
      heading: "New wishlist: " + email,
      intro: "A customer saved " + list.length + " item" + (list.length === 1 ? "" : "s") + " to their wishlist.",
      rows,
      itemsTitle: "What they saved",
      items,
      link: { label: "View lead", href: viewUrl },
      footerNote: "You get one alert per customer per 7 days. More under Wishlist Leads in the ONG Controls app.",
    };
    const mail = () =>
      teamCopy({
        buildExact: async () => (await import("./wishlist.server")).buildWishlistEmailForTeam(admin, String(email), list.map((p) => p.handle).filter(Boolean), list),
        strip: { kicker: "New wishlist", title: String(email), rows, viewUrl, viewLabel: "View lead" },
        plain,
      });
    return await notifyTeam({ shop, settings, kind: "wishlist", refId: String(email).toLowerCase(), dedupeMs: WISHLIST_REPEAT_MS, subject: "New wishlist: " + email, email: mail });
  } catch (err) {
    console.error("[leadAlerts] wishlist alert failed:", err);
    return "failed: " + String((err && err.message) || err).slice(0, 200);
  }
}

// ------------------------------------------------------------------ abandoned checkout

function idleMinutesFor(settings) {
  const n = parseInt(settings.abandonedCheckoutDelayMinutes, 10);
  return Math.min(1440, Math.max(15, Number.isFinite(n) && n > 0 ? n : 60));
}

/**
 * One pass over recent abandoned checkouts: tells the team about each one (once) after it has been idle
 * for the same time the customer reminder waits (default 1 hour). Independent of the customer reminder
 * email being on. Only checkouts started after the alert was switched on are ever alerted.
 * Runs from the 5-minute job; returns a small summary for that job's response.
 */
export async function runAbandonedCheckoutTeamAlerts({ admin, shop, now = new Date() }) {
  try {
    const settings = await getAppSettings(shop);
    if (!isAlertOn(settings, "checkout")) return { enabled: false, alerted: 0 };
    if (!parseRecipients(settings.leadAlertEmails).valid.length) return { enabled: true, alerted: 0, note: "no team email addresses saved" };
    if (!settings.gmailUser || !settings.gmailAppPassword) return { enabled: true, alerted: 0, note: "Gmail is not connected" };

    const nowMs = now.getTime();
    const onSince = settings.leadAlertCheckoutSince ? new Date(settings.leadAlertCheckoutSince).getTime() : nowMs;
    const sinceMs = Math.max(nowMs - CHECKOUT_MAX_AGE_MS, onSince);
    const idleMs = idleMinutesFor(settings) * 60 * 1000;

    const { fetchRecentCheckouts } = await import("./abandonedCheckoutEmail.server");
    const checkouts = await fetchRecentCheckouts(admin, new Date(sinceMs));
    const due = checkouts.filter((c) => {
      if (c.completedAt || !c.items.length || !c.email) return false;
      if (new Date(c.createdAt).getTime() < sinceMs) return false;
      if (c.lastOrderAt && new Date(c.lastOrderAt).getTime() >= new Date(c.createdAt).getTime()) return false;
      return nowMs - new Date(c.updatedAt || c.createdAt).getTime() >= idleMs;
    });
    if (!due.length) return { enabled: true, alerted: 0, checked: checkouts.length };

    const ids = due.map((c) => c.id);
    const rows = await prisma.leadAlert.findMany({ where: { kind: "checkout", refId: { in: ids } }, select: { refId: true, status: true } });
    const done = new Set(rows.filter((r) => r.status === "sent").map((r) => r.refId));
    const failures = {};
    for (const r of rows) if (String(r.status).startsWith("failed")) failures[r.refId] = (failures[r.refId] || 0) + 1;

    let alerted = 0;
    let failed = 0;
    for (const c of due) {
      if (alerted + failed >= MAX_CHECKOUT_ALERTS_PER_RUN) break;
      if (done.has(c.id) || (failures[c.id] || 0) >= MAX_FAILED_TRIES) continue;
      const currency = (c.total && c.total.currency) || "INR";
      const lines = c.items.map((it) => {
        const extra = [it.variantTitle && it.variantTitle !== "Default Title" ? it.variantTitle : "", ...(it.props || [])].filter(Boolean).join(", ");
        return (it.title || "Item") + (it.quantity > 1 && !it.isCustomisation ? " x" + it.quantity : "") + (extra ? " (" + extra + ")" : "");
      });
      let total = "";
      if (c.total && c.total.amount != null) {
        try { total = new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(c.total.amount)); } catch { total = currency + " " + c.total.amount; }
      }
      const rows = [
        ["Customer", c.fullName || ""],
        ["Email", emailValue(c.email)],
        ["In the cart", lines.join("; ")],
        ["Cart total", total],
        ["Checkout link", c.url || ""],
        ["Started", formatIst(c.createdAt)],
        ["Last activity", formatIst(c.updatedAt)],
        ["Reminder email", c.consent ? "The customer agreed to marketing emails" : "No marketing consent: the automatic reminder will not go to them"],
      ];
      // Abandoned carts live in Shopify, not in this app's own lead tables, so View lead opens the app's
      // Abandoned cart emails list; the customer's own checkout link is the button inside the email below.
      const viewUrl = adminAppUrl(shop, "whatsapp-events?tab=abandoned");
      const plain = {
        heading: "Abandoned checkout " + (c.name || "") + (c.fullName ? " by " + c.fullName : ""),
        intro: "A customer started a checkout and left without paying.",
        rows,
        itemsTitle: "In the cart",
        items: lines,
        link: { label: "View lead", href: viewUrl },
        footerNote: "This alert is for your team only. It is sent once per checkout.",
      };
      const mail = () =>
        teamCopy({
          buildExact: async () => (await import("./abandonedCheckoutEmail.server")).buildAbandonedEmailForTeam(admin, settings, c),
          strip: { kicker: "Abandoned checkout", title: (c.name || "") + (c.fullName ? " by " + c.fullName : ""), rows, viewUrl, viewLabel: "View lead" },
          plain,
        });
      const status = await notifyTeam({ shop, settings, kind: "checkout", refId: c.id, subject: "Abandoned checkout " + (c.name || "") + (total ? " (" + total + ")" : ""), email: mail });
      if (status === "sent") alerted += 1;
      else if (String(status).startsWith("failed")) failed += 1;
      else if (String(status).startsWith("skipped: hourly")) break;
    }
    return { enabled: true, alerted, failed, checked: checkouts.length, due: due.length };
  } catch (err) {
    console.error("[leadAlerts] abandoned checkout pass failed:", err);
    return { error: String((err && err.message) || err) };
  }
}

// ------------------------------------------------------------------ Settings page helpers

/** The Settings test button: a clearly-marked sample alert to every saved team address. */
export async function sendTestLeadAlert(shop, admin) {
  const settings = await getAppSettings(shop);
  const viewUrl = adminAppUrl(shop, "astro-leads");
  const sampleRows = [
    ["Name", "Test Customer"],
    ["Phone", phoneValue("+91 98765 43210")],
    ["Email", emailValue("test.customer@example.com")],
    ["Ascendant", "Leo"],
    ["Life stone", "Blue Sapphire (for Saturn)"],
    ["Customer email", "Sent"],
  ];
  // A real sample in the same layout as a live alert: the customer's recommendation email under the team box.
  const sample = () =>
    teamCopy({
      buildExact: async () =>
        (await import("./astroAdvice.server")).buildGemRecommendationEmailForTeam(
          admin,
          settings,
          { name: "Test Customer", email: "test.customer@example.com", phone: "+91 98765 43210", dob: "1990-08-15", tob: "14:30", placeOfBirth: "New Delhi" },
          { ascendant: "Leo", moonsign: "Cancer" },
          {
            life: { gem: "Blue Sapphire", planet: "Saturn", collection: "blue-sapphire", tagline: "for Good Fortune, Wealth & Success" },
            benefic: { gem: "Emerald", planet: "Mercury", collection: "emerald", tagline: "for Health, Success & Growth" },
            lucky: { gem: "Diamond", planet: "Venus", collection: "diamond", tagline: "for Luxury, Love & Elegance" },
          }
        ),
      strip: { kicker: "TEST: new gem recommendation lead", title: "Test Customer", rows: sampleRows, viewUrl, viewLabel: "View lead" },
      plain: null,
    });
  const fallback = () => buildAlertEmail({
    heading: "TEST: team lead alert",
    intro: "This is a test from Settings -> Team lead alerts.",
    rows: sampleRows,
    link: { label: "View lead", href: viewUrl },
  });
  const mail = admin ? async () => { try { return await sample(); } catch { return fallback(); } } : fallback();
  return notifyTeam({ shop, settings, kind: "test", refId: "test-" + Date.now(), subject: "TEST: team lead alert", email: mail, force: true });
}

export async function getRecentLeadAlerts(shop, take = 10) {
  try {
    return await prisma.leadAlert.findMany({
      where: { OR: [{ shop }, { shop: null }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, kind: true, subject: true, status: true, createdAt: true, recipients: true },
    });
  } catch {
    return [];
  }
}
