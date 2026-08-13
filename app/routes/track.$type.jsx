/**
 * Email open/click tracking — https://<render-url>/track/open?id=...
 * and https://<render-url>/track/click?id=...&url=...
 *
 * Deliberately NOT under the app proxy: these links are hit directly by
 * the recipient's mail client (Gmail's image proxy, a browser after
 * clicking, etc.), which has no Shopify session/signature to present —
 * they have to work standalone, on this app's own public Render domain.
 * See app/utils/astroAdvice.server.js for where these URLs get built
 * into the email.
 *
 * A 1x1 transparent GIF is served for real (unlike the old Apps Script
 * version, which couldn't return true binary/image content from doGet
 * and had to fall back to an empty text response) — a small but genuine
 * upgrade from moving off Apps Script.
 */
import prisma from "../db.server";
import { mirrorEmailEventToSheet } from "../utils/googleSheets.server";
import { getAppSettings } from "../utils/appSettings.server";

const STORE_DOMAIN = "onlynaturalgemstones.com";

// 1x1 transparent GIF, decoded once at module load.
const TRANSPARENT_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64"
);

async function logEvent(trackingId, event, detail) {
  try {
    await prisma.emailEvent.create({ data: { trackingId: trackingId || "", event, detail: detail || "" } });
  } catch (err) {
    console.error(`[track.$type] failed to log "${event}" event for ${trackingId}:`, err);
  }
  // This route has no login/session context (hit directly by mail
  // clients) — resolve which shop's Sheet to mirror into by looking up
  // the lead this trackingId belongs to.
  try {
    const lead = trackingId ? await prisma.astroLead.findUnique({ where: { trackingId } }) : null;
    const settings = await getAppSettings(lead?.shop);
    await mirrorEmailEventToSheet(settings, trackingId, event, detail);
  } catch (err) {
    console.error(`[track.$type] failed to mirror "${event}" event to sheet:`, err);
  }
}

export const loader = async ({ params, request }) => {
  const url = new URL(request.url);
  const trackingId = url.searchParams.get("id");
  const type = params.type;

  if (type === "open") {
    // Never let logging failures block returning the pixel — a broken
    // image is far more noticeable to a human than a missed log row.
    await logEvent(trackingId, "opened", "");
    return new Response(TRANSPARENT_PIXEL, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  }

  if (type === "click") {
    let destination = url.searchParams.get("url") || "";
    // Only ever redirect to our own store — this param is
    // attacker-visible (public query string), so don't let it become an
    // open redirect to an arbitrary third-party site.
    if (!destination || destination.indexOf("https://" + STORE_DOMAIN) !== 0) {
      destination = "https://" + STORE_DOMAIN;
    }
    // Which specific link this is (e.g. "life_buy_now",
    // "view_full_recommendation") — every link built in
    // astroAdvice.server.js now carries one, so a click event records
    // exactly what was clicked, not just that something was.
    const label = url.searchParams.get("label") || "";
    const detail = label ? `${label} -> ${destination}` : destination;
    await logEvent(trackingId, "clicked", detail);
    return new Response(null, { status: 302, headers: { Location: destination } });
  }

  return new Response("Not found", { status: 404 });
};
