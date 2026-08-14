/**
 * Receives Interakt's webhook for WhatsApp template message status
 * (sent/delivered/read/failed) — the ONLY way to get real delivery/read
 * data into our own app, since Interakt has no "fetch campaign stats"
 * API (confirmed via their docs). Logs every event into
 * WhatsAppMessageEvent, which app/routes/app.whatsapp-events.jsx reads.
 *
 * Setup (one-time, in Interakt -> Settings -> Developer Setting ->
 * Webhooks): register this URL —
 *   https://shubh-gems-customizer-app.onrender.com/public/interakt-webhook
 * — along with a secret you choose, pasted into our Settings page's
 * "Interakt Webhook Secret" field (must match on both sides).
 *
 * Public route (no Shopify admin session — Interakt calls this directly,
 * server-to-server), authenticated instead via HMAC-SHA256 signature
 * verification (Interakt-Signature header) using that shared secret —
 * same trust model as Shopify's own webhook HMAC verification.
 *
 * Interakt requires a response within 3 seconds or it counts as a
 * failure (5 failures in 10 minutes disables the webhook entirely) — this
 * handler does exactly one settings lookup + one DB insert, deliberately
 * nothing slower than that.
 *
 * Payload shape (confirmed via Interakt's docs):
 * {
 *   "type": "message_api_sent" | "message_api_delivered" | "message_api_read" | "message_api_failed",
 *   "data": {
 *     "customer": { "channel_phone_number": "917003705584", ... },
 *     "message": {
 *       "id": "...",
 *       "message_status": "Sent" | "Delivered" | "Read" | "Failed",
 *       "channel_failure_reason": "..." | null,
 *       "meta_data": { "source_data": { "callback_data": "astro-<trackingId>" } }
 *     }
 *   }
 * }
 */
import crypto from "node:crypto";
import db from "../db.server";
import prisma from "../db.server";
import { getAppSettings } from "../utils/appSettings.server";

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const loader = async () => {
  // Not a real webhook receiver path (Interakt only ever POSTs) — just a
  // harmless 200 in case anything hits this with a GET (e.g. Interakt's
  // own URL-reachability check when you first save the webhook config).
  return new Response("OK", { status: 200 });
};

export const action = async ({ request }) => {
  // This app is installed on a single store in practice (same assumption
  // the cron.*.jsx routes already make) — resolve its settings to get
  // the webhook secret to verify against.
  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) return new Response("Not configured", { status: 503 });
  const settings = await getAppSettings(session.shop);

  const rawBody = await request.text();
  const signature = request.headers.get("Interakt-Signature") || "";
  if (!verifySignature(rawBody, signature, settings.interaktWebhookSecret)) {
    console.error("[interakt-webhook] signature verification failed or secret not configured");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[interakt-webhook] invalid JSON body:", err);
    return new Response("Invalid body", { status: 400 });
  }

  try {
    const message = payload?.data?.message || {};
    const customer = payload?.data?.customer || {};
    const callbackData = message?.meta_data?.source_data?.callback_data || "";
    const trackingId = callbackData.startsWith("astro-") ? callbackData.slice("astro-".length) : null;

    await prisma.whatsAppMessageEvent.create({
      data: {
        messageId: message.id || "",
        trackingId,
        phone: customer.channel_phone_number || null,
        status: message.message_status || "Unknown",
        failureReason: message.channel_failure_reason || null,
        eventType: payload?.type || "unknown",
      },
    });
  } catch (err) {
    // Still return 200 — a logging failure on our end shouldn't cause
    // Interakt to retry-and-eventually-disable the webhook over
    // something we can fix later by re-checking Render's logs.
    console.error("[interakt-webhook] failed to log event:", err);
  }

  return new Response("OK", { status: 200 });
};
