/**
 * WhatsApp "first + follow-up" flow. The first message always sends
 * instantly at submission time (see handleAstroAdviceSubmission in
 * astroAdvice.server.js) — this module only handles the SECOND message:
 * a one-time reminder (same template, resent) sent once
 * AppSettings.whatsappIntervalValue/Unit has elapsed since that lead's
 * whatsappFirstSentAt. "0"/blank interval means follow-ups are off.
 *
 * This is a separate leaf module (imports FROM astroAdvice.server.js and
 * appSettings.server.js, neither of which import back from here) purely
 * to avoid a circular dependency — same reasoning as interakt.server.js.
 *
 * Call processWhatsAppQueue repeatedly (see cron.whatsapp-queue.jsx, and
 * the Astro Leads dashboard's manual "Process Follow-ups Now" button) to
 * send whichever follow-ups have come due since the last check.
 */
import prisma from "../db.server";
import { getAppSettings, whatsappIntervalMs } from "./appSettings.server";
import { sendWhatsAppForLead } from "./astroAdvice.server";

// Safety cap per run — avoids one cron tick trying to send hundreds of
// follow-ups at once if the queue ever backs up (cron down for a while,
// etc.). Runs again next tick and picks up wherever it left off (oldest
// whatsappFirstSentAt first).
const MAX_PER_RUN = 20;

// Old sentinel from before this feature was reworked from "pace every
// send" into "instant first + one follow-up" — anything still marked
// this way needs its FIRST message sent now (that concept doesn't exist
// anymore; first messages always send instantly going forward). One-time
// backward-compatibility cleanup, harmless to keep checking indefinitely.
const OLD_QUEUED_PREFIX = "queued: waiting for pacing window";

export async function processWhatsAppQueue(admin, shop) {
  const settings = await getAppSettings(shop);

  const stuckFirst = await prisma.astroLead.findMany({
    where: { shop, whatsappSendStatus: { startsWith: OLD_QUEUED_PREFIX } },
    orderBy: { createdAt: "asc" },
  });
  const firstCatchUpResults = [];
  for (const lead of stuckFirst) {
    let status;
    try {
      status = await sendWhatsAppForLead(admin, settings, lead);
    } catch (err) {
      status = "threw: " + err;
    }
    await prisma.astroLead.update({
      where: { id: lead.id },
      data: { whatsappSendStatus: status, whatsappFirstSentAt: new Date() },
    });
    firstCatchUpResults.push({ leadId: lead.id, status });
  }

  const intervalMs = whatsappIntervalMs(settings);
  if (intervalMs <= 0) {
    return { followUpEnabled: false, firstCatchUp: firstCatchUpResults.length, sent: 0 };
  }

  const cutoff = new Date(Date.now() - intervalMs);
  const due = await prisma.astroLead.findMany({
    where: {
      shop,
      phone: { not: null },
      whatsappFirstSentAt: { not: null, lte: cutoff },
      whatsappFollowUpSentAt: null,
    },
    orderBy: { whatsappFirstSentAt: "asc" },
    take: MAX_PER_RUN,
  });

  const results = [];
  for (const lead of due) {
    let status;
    try {
      status = await sendWhatsAppForLead(admin, settings, lead);
    } catch (err) {
      status = "threw: " + err;
      console.error("[whatsappQueue] follow-up send failed for lead", lead.id, err);
    }
    try {
      await prisma.astroLead.update({
        where: { id: lead.id },
        data: { whatsappFollowUpStatus: status, whatsappFollowUpSentAt: new Date() },
      });
    } catch (updateErr) {
      console.error("[whatsappQueue] failed to record follow-up result for lead", lead.id, updateErr);
    }
    results.push({ leadId: lead.id, status });
  }

  return { followUpEnabled: true, firstCatchUp: firstCatchUpResults.length, sent: results.length, results };
}

/** Read-only summary for the Astro Leads dashboard: how many leads are
 * currently waiting on their follow-up, and the earliest one's due time. */
export async function getWhatsAppQueueSummary(shop) {
  const settings = await getAppSettings(shop);
  const intervalMs = whatsappIntervalMs(settings);

  const pending = await prisma.astroLead.findMany({
    where: { shop, phone: { not: null }, whatsappFirstSentAt: { not: null }, whatsappFollowUpSentAt: null },
    orderBy: { whatsappFirstSentAt: "asc" },
    select: { id: true, name: true, email: true, phone: true, whatsappFirstSentAt: true },
  });

  const nextDue =
    intervalMs > 0 && pending[0]?.whatsappFirstSentAt
      ? new Date(pending[0].whatsappFirstSentAt.getTime() + intervalMs)
      : null;

  return {
    followUpEnabled: intervalMs > 0,
    pending: pending.map((l) => ({ ...l, whatsappFirstSentAt: l.whatsappFirstSentAt.toISOString() })),
    nextDue: nextDue ? nextDue.toISOString() : null,
  };
}
