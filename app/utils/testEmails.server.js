/**
 * "Send a test email" from the Settings page: sends the real wishlist /
 * order-processing / astro-advice email, built by the same code as the live
 * ones, to an address you type -- filled with sample or your latest saved data
 * so nothing is sent to any customer and no lead/order record is touched.
 */
import crypto from "crypto";
import prisma from "../db.server";
import { getAppSettings } from "./appSettings.server";
import { sendWishlistEmail } from "./wishlist.server";
import { sendOrderProcessingEmail } from "./orderProcessingEmail.server";
import { sendGemRecommendationEmail } from "./astroAdvice.server";

async function sampleProducts(admin) {
  const res = await admin.graphql(`#graphql
    query TestEmailProducts {
      products(first: 3, query: "status:active") {
        nodes { handle title featuredImage { url } priceRangeV2 { minVariantPrice { amount } } }
      }
    }`);
  const nodes = (await res.json())?.data?.products?.nodes || [];
  return nodes.map((p) => ({
    handle: p.handle,
    title: p.title,
    imageUrl: p.featuredImage?.url || "",
    price: p.priceRangeV2?.minVariantPrice?.amount || null,
  }));
}

export async function sendTestEmail(admin, shop, kind, to) {
  const email = String(to || "").trim();
  if (!email || !email.includes("@")) return "error: enter a valid email address first";
  const settings = await getAppSettings(shop);
  const trackingId = "test-" + crypto.randomUUID();

  if (kind === "wishlist") {
    const products = await sampleProducts(admin);
    if (!products.length) return "error: no active products found to use as sample wishlist items";
    return sendWishlistEmail(admin, settings, email, products.map((p) => p.handle), products, trackingId);
  }

  if (kind === "processing") {
    return sendOrderProcessingEmail(admin, settings, {
      email,
      name: "#TEST-1001",
      customer: { first_name: "Test" },
    });
  }

  if (kind === "astro") {
    const lead = await prisma.astroLead.findFirst({
      where: { shop, NOT: { recommendation: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!lead) return "error: no saved astro lead with a recommendation to use as sample data yet";
    return sendGemRecommendationEmail(
      admin,
      settings,
      { name: lead.name || "Test", email },
      { ascendant: lead.ascendant, moonsign: lead.moonsign, sunsign: lead.sunsign },
      lead.recommendation,
      trackingId
    );
  }

  return "error: unknown email type";
}
