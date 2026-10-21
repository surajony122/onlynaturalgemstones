/**
 * Shared handler for Shopify's "<thing> was deleted" webhooks. Writes one row
 * to the store activity log (StoreDeletionEvent) with the exact time, and --
 * when Shopify's event history says -- who did it. Redelivered webhooks are
 * ignored (same resource, same kind, within a day).
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logDeletion, lookupDeleteAuthor } from "./storeActivity.server";

export async function handleDeleteWebhook(request, { kind, subjectType, titleOf }) {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  const id = payload?.id != null ? String(payload.id) : null;
  console.log(`Received ${topic} webhook for ${shop} (${kind} ${id})`);
  try {
    if (id) {
      const dup = await prisma.storeDeletionEvent.findFirst({
        where: { shop, kind, resourceId: id, source: "webhook", detectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (dup) return new Response();
    }
    let actor = null;
    let note = null;
    if (subjectType && id) {
      const who = await lookupDeleteAuthor(admin, subjectType, id);
      if (who) {
        actor = who.author || null;
        note = who.message || null;
      }
    }
    await logDeletion({
      shop,
      kind,
      resourceId: id,
      title: (titleOf && titleOf(payload)) || null,
      detail: payload?.handle || payload?.admin_graphql_api_id || null,
      source: "webhook",
      actor,
      happenedAt: new Date(),
      note,
    });
  } catch (err) {
    console.error(`[deleteWebhook] could not record ${kind} ${id}:`, err);
  }
  return new Response();
}
