/**
 * App Proxy endpoint: https://<store-domain>/apps/customize/article-view
 *
 * Increments and returns a simple hit counter for one blog article (per
 * explicit request: a plain hit count, no per-visitor dedup) — called
 * once per page load from sections/main-article.liquid's own inline
 * script. `articleId` is Shopify's own numeric article id.
 *
 * Request body (JSON): { articleId }
 * Response (JSON): { count } or { error }
 */
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) {
    return Response.json({ error: "Shop not authenticated" }, { status: 401 });
  }

  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const articleId = String(data.articleId || "");
  if (!articleId) {
    return Response.json({ error: "Missing articleId" }, { status: 400 });
  }

  try {
    const row = await prisma.articleView.upsert({
      where: { articleId },
      create: { shop: session.shop, articleId, count: 1 },
      update: { count: { increment: 1 } },
    });
    return Response.json({ count: row.count });
  } catch (err) {
    console.error("[proxy.article-view] unhandled error:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
};
