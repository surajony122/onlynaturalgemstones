/**
 * "Retry all unsent": finds the leads whose email / WhatsApp message never went out (failed, skipped for a reason
 * that can change, or stuck) and sends the missing message again. Used by the Overview and System Health pages.
 * The rule for what counts as "never went out" is shared with the lead pages (retryRules.js).
 *
 * Wishlist: only each customer's newest lead counts (older ones were replaced by a newer save).
 * Astro: every lead counts.
 */
import prisma from "../db.server";
import { leadNeedsRetry } from "./retryRules";
import { resendWishlistLeadEmail, resendWishlistWhatsapp } from "./wishlist.server";
import { resendAstroLeadEmail, sendWhatsAppForLead } from "./astroAdvice.server";
import { getAppSettings } from "./appSettings.server";

const SINCE_DAYS = 7;
const MAX_PER_RUN = 40;

export async function retryUnsentLeads({ admin, shop, kind }) {
  const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);
  let emailOk = 0;
  let waOk = 0;
  let failed = 0;
  let checked = 0;

  if (kind === "wishlist") {
    const leads = await prisma.wishlistLead.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    const seen = new Set();
    const targets = [];
    for (const l of leads) {
      const key = String(l.email || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const needEmail = l.email && leadNeedsRetry(l.emailSendStatus, l.createdAt);
      const needWa = l.phone && leadNeedsRetry(l.whatsappSendStatus, l.createdAt);
      if (needEmail || needWa) targets.push({ l, needEmail, needWa });
    }
    for (const { l, needEmail, needWa } of targets.slice(0, MAX_PER_RUN)) {
      checked += 1;
      if (needEmail) {
        let st;
        try { st = String(await resendWishlistLeadEmail(admin, l.id)); } catch (e) { st = "threw: " + String((e && e.message) || e); }
        if (/^OK/i.test(st)) emailOk += 1; else failed += 1;
      }
      if (needWa) {
        let st;
        try { st = String(await resendWishlistWhatsapp(l.id)); } catch (e) { st = "threw: " + String((e && e.message) || e); }
        if (/^OK/i.test(st)) waOk += 1; else failed += 1;
      }
    }
  } else if (kind === "astro") {
    const leads = await prisma.astroLead.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    const targets = leads
      .map((l) => ({ l, needEmail: l.email && leadNeedsRetry(l.emailSendStatus, l.createdAt), needWa: l.phone && leadNeedsRetry(l.whatsappSendStatus, l.createdAt) }))
      .filter((t) => t.needEmail || t.needWa);
    for (const { l, needEmail, needWa } of targets.slice(0, MAX_PER_RUN)) {
      checked += 1;
      if (needEmail) {
        let st;
        try { st = String(await resendAstroLeadEmail(admin, l.id)); } catch (e) { st = "threw: " + String((e && e.message) || e); }
        if (/^OK/i.test(st)) emailOk += 1; else failed += 1;
      }
      if (needWa) {
        let st;
        try {
          const settings = await getAppSettings(l.shop || shop);
          st = String(await sendWhatsAppForLead(admin, settings, l));
          await prisma.astroLead.update({ where: { id: l.id }, data: { whatsappSendStatus: st, whatsappFirstSentAt: l.whatsappFirstSentAt || new Date() } });
        } catch (e) {
          st = "threw: " + String((e && e.message) || e);
        }
        if (/^OK/i.test(st)) waOk += 1; else failed += 1;
      }
    }
  } else {
    return { ok: false, error: "Unknown kind" };
  }

  return { ok: true, intent: "retryUnsent", kind, checked, emailOk, waOk, failed };
}
