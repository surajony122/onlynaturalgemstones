/**
 * Open / click tracking for the TEAM lead alert emails (Settings -> Team lead alerts):
 *   /track/team/open?id=<alert id>&r=<team member's address>
 *   /track/team/click?id=<alert id>&r=<team member's address>&label=view_lead&url=<link>
 *
 * Kept separate from /track/open and /track/click on purpose, which are the CUSTOMER tracking and feed the
 * lead pages' open / click counts. Events are stored as EmailEvent rows with trackingId "team:<alert id>"
 * and detail = the team member's address (clicks: "label -> url | address"), and shown under Settings ->
 * Team lead alerts -> Latest alerts. Hit directly by the recipient's mail client, so no login here.
 */
import prisma from "../db.server";

const TRANSPARENT_PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

// A click may only ever lead into the Shopify admin (where this app lives), never an arbitrary site.
const ALLOWED_DESTINATION = "https://admin.shopify.com/";

async function logTeamEvent(alertId, event, detail) {
  if (!alertId) return;
  try {
    await prisma.emailEvent.create({ data: { trackingId: "team:" + alertId, event, detail: detail || "" } });
  } catch (err) {
    console.error(`[track.team] failed to log "${event}" for ${alertId}:`, err);
  }
}

export const loader = async ({ params, request }) => {
  const url = new URL(request.url);
  const alertId = url.searchParams.get("id");
  const who = (url.searchParams.get("r") || "").slice(0, 200);

  if (params.type === "open") {
    await logTeamEvent(alertId, "opened", who);
    return new Response(TRANSPARENT_PIXEL, {
      status: 200,
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }

  if (params.type === "click") {
    let destination = url.searchParams.get("url") || "";
    if (!destination.startsWith(ALLOWED_DESTINATION)) destination = ALLOWED_DESTINATION;
    const label = url.searchParams.get("label") || "link";
    await logTeamEvent(alertId, "clicked", `${label} -> ${destination} | ${who}`);
    return new Response(null, { status: 302, headers: { Location: destination } });
  }

  return new Response("Not found", { status: 404 });
};
