/**
 * WhatsApp send pacing — advances the queue of AstroLeads waiting for
 * their gem-recommendation WhatsApp message by AT MOST ONE lead per call,
 * only once the configured gap since the last shop-wide send has passed.
 * Spacing sends out like this (instead of firing one the instant every
 * lead submits) is a widely-recommended mitigation for Meta's error
 * 131049 ("didn't deliver due to their per-user limit on marketing
 * notifications") that a brand-new WhatsApp Business sender number tends
 * to trip when bursting messages.
 *
 * Leads get INTO the queue (whatsappSendStatus = "queued: waiting for
 * pacing window") from handleAstroAdviceSubmission in astroAdvice.server.js,
 * only when pacing is turned on (Settings → WhatsApp send pacing). This
 * file is a separate leaf module (imports FROM astroAdvice.server.js and
 * appSettings.server.js, neither of which import back from here) purely
 * to avoid a circular dependency — same reasoning as interakt.server.js.
 *
 * Call processWhatsAppQueue repeatedly (see cron.whatsapp-queue.jsx, and
 * the Astro Leads dashboard's manual "Process Queue Now" button) to drain
 * the queue over time — each call only ever sends 0 or 1 message, by
 * design; that IS the pacing.
 */
import prisma from "../db.server";
import { getAppSettings, whatsappIntervalMs, getWhatsappLastSentAt, setWhatsappLastSentAt } from "./appSettings.server";
import { sendWhatsAppForLead } from "./astroAdvice.server";

const QUEUED_STATUS_PREFIX = "queued";

async function sendAndRecord(admin, settings, lead) {
  let status;
  try {
    status = await sendWhatsAppForLead(admin, settings, lead);
  } catch (err) {
    status = "threw: " + err;
    console.error("[whatsappQueue] send failed for lead", lead.id, err);
  }
  try {
    await prisma.astroLead.update({ where: { id: lead.id }, data: { whatsappSendStatus: status } });
  } catch (updateErr) {
    console.error("[whatsappQueue] failed to record result for lead", lead.id, updateErr);
  }
  return status;
}

export async function processWhatsAppQueue(admin, shop) {
  const settings = await getAppSettings(shop);
  const intervalMs = whatsappIntervalMs(settings);

  if (intervalMs <= 0) {
    // Pacing is off (or was turned off after some leads were already
    // queued while it was on) — nothing should sit in the queue forever
    // waiting for a window that no longer applies, so catch up everything
    // still queued right now instead of just one.
    const stuck = await prisma.astroLead.findMany({
      where: { shop, whatsappSendStatus: { startsWith: QUEUED_STATUS_PREFIX } },
      orderBy: { createdAt: "asc" },
    });
    const results = [];
    for (const lead of stuck) {
      results.push({ leadId: lead.id, status: await sendAndRecord(admin, settings, lead) });
    }
    return { pacingEnabled: false, sent: results.length, results };
  }

  const lastSentAt = await getWhatsappLastSentAt(shop);
  const dueAt = lastSentAt ? new Date(lastSentAt.getTime() + intervalMs) : null;
  if (dueAt && dueAt > new Date()) {
    return { pacingEnabled: true, sent: 0, nextSendAt: dueAt.toISOString(), note: "Not due yet" };
  }

  const nextLead = await prisma.astroLead.findFirst({
    where: { shop, whatsappSendStatus: { startsWith: QUEUED_STATUS_PREFIX } },
    orderBy: { createdAt: "asc" },
  });
  if (!nextLead) {
    return { pacingEnabled: true, sent: 0, note: "Queue is empty" };
  }

  const status = await sendAndRecord(admin, settings, nextLead);
  // Recorded even on failure — a permanently-broken lead (bad phone,
  // template rejected, etc.) would otherwise re-claim every future window
  // forever and block everyone queued behind it.
  await setWhatsappLastSentAt(shop, new Date());

  return { pacingEnabled: true, sent: 1, leadId: nextLead.id, status };
}

/** Read-only summary for the Astro Leads dashboard: how many leads are
 * currently waiting, and (if pacing is on and at least one send has ever
 * happened) the estimated next-send time. */
export async function getWhatsAppQueueSummary(shop) {
  const settings = await getAppSettings(shop);
  const intervalMs = whatsappIntervalMs(settings);

  const queued = await prisma.astroLead.findMany({
    where: { shop, whatsappSendStatus: { startsWith: QUEUED_STATUS_PREFIX } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
  });

  const lastSentAt = await getWhatsappLastSentAt(shop);
  const nextSendAt = intervalMs > 0 && lastSentAt ? new Date(lastSentAt.getTime() + intervalMs) : null;

  return {
    pacingEnabled: intervalMs > 0,
    queued: queued.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    nextSendAt: nextSendAt ? nextSendAt.toISOString() : null,
  };
}
