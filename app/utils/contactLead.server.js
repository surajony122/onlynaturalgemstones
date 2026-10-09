/**
 * Contact-us form leads. The storefront form still sends Shopify's own contact email;
 * the theme also posts a copy here (App Proxy: /apps/customize/contact-lead) so the
 * message is kept and tracked in the app.
 */
import prisma from "../db.server";

export const CONTACT_STATUSES = ["New", "Contacted", "Closed", "Spam"];

const MAX_PER_EMAIL_PER_HOUR = 5;
const clean = (v, max) => String(v == null ? "" : v).replace(/\u0000/g, "").trim().slice(0, max);

/** Saves one submission. Returns { ok } or { ok:false, error }. Never throws for bad input. */
export async function saveContactLead(shop, data) {
  const d = data || {};
  // Hidden "website" box: people never fill it in, bots usually do. Pretend success, save nothing.
  if (clean(d.website, 200)) return { ok: true, ignored: true };

  const email = clean(d.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "A valid email address is required." };

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.contactLead.count({ where: { email, createdAt: { gte: since } } });
  if (recent >= MAX_PER_EMAIL_PER_HOUR) return { ok: true, ignored: true };

  await prisma.contactLead.create({
    data: {
      shop: shop || null,
      name: clean(d.name, 200) || null,
      email,
      phone: clean(d.phone, 40) || null,
      message: clean(d.message, 5000) || null,
      source: clean(d.source, 300) || null,
    },
  });
  return { ok: true };
}
