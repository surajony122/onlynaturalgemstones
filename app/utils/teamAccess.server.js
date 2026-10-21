/**
 * Team access: works out WHO opened the app (a Shopify staff member) and WHICH
 * pages they may open.
 *
 *  - The decoded session token gives Shopify's id for the person (`sub`). To get
 *    their name and email, the app asks Shopify for an ONLINE token through
 *    token exchange and only reads the user details from it (it is not kept and
 *    not used for API calls -- the app's normal connection stays as it is).
 *  - Each person is saved as a TeamMember; unknown people start with no pages.
 *  - Until an admin turns "enforce" on (Team access page) nothing is blocked:
 *    people are only recorded. After that, a person sees only the pages ticked
 *    for them; admins and the shop owner see everything.
 *  - Pages and actions call authenticatePage(request, pageId) instead of
 *    authenticate.admin(request); it returns the same object plus `access`.
 */
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ADMIN_ONLY_PAGES, OPEN_PAGES, ASSIGNABLE_IDS } from "./teamPages";

const SEEN_EVERY_MS = 5 * 60 * 1000;

export function getEncodedSessionToken(request) {
  const header = request.headers.get("authorization") || "";
  if (/^bearer /i.test(header)) return header.slice(7).trim();
  return new URL(request.url).searchParams.get("id_token") || null;
}

/** Reads the staff member's details from Shopify via token exchange (online token). Returns null on any problem. */
async function fetchShopifyUser(shop, idToken) {
  if (!idToken || !process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) return null;
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.associated_user || null;
  } catch {
    return null;
  }
}

const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || null;

async function resolveMember({ shop, uid, idToken }) {
  let member = await prisma.teamMember.findFirst({ where: { shop, shopifyUserId: uid } });
  const now = new Date();

  if (member && member.email) {
    if (!member.lastSeenAt || now - member.lastSeenAt > SEEN_EVERY_MS) {
      member = await prisma.teamMember.update({ where: { id: member.id }, data: { lastSeenAt: now } });
    }
    return member;
  }

  // A person whose details are still missing is retried at most every few minutes (not on every click).
  if (member && now - member.updatedAt < SEEN_EVERY_MS) return member;

  // New person (or one whose details are still missing): ask Shopify who they are.
  const user = await fetchShopifyUser(shop, idToken);
  const email = user?.email ? String(user.email).toLowerCase() : null;
  const isOwner = !!user?.account_owner;

  if (!member && email) {
    // someone an admin added by email before their first visit
    const invited = await prisma.teamMember.findFirst({ where: { shop, shopifyUserId: null, email: { equals: email, mode: "insensitive" } } });
    if (invited) {
      return prisma.teamMember.update({
        where: { id: invited.id },
        data: { shopifyUserId: uid, name: fullName(user) || invited.name, isOwner: invited.isOwner || isOwner, firstSeenAt: now, lastSeenAt: now },
      });
    }
  }
  if (member) {
    return prisma.teamMember.update({
      where: { id: member.id },
      data: { email: email || member.email, name: fullName(user) || member.name, isOwner: member.isOwner || isOwner, lastSeenAt: now },
    });
  }
  return prisma.teamMember.create({
    data: {
      shop,
      shopifyUserId: uid,
      email,
      name: fullName(user),
      isOwner,
      // the shop owner becomes the first admin automatically
      isAdmin: isOwner,
      pages: [],
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
}

export function buildAccess({ enforce, member, identityError, noAdminYet = false }) {
  const isAdmin = !!(member && (member.isOwner || member.isAdmin));
  // The Team access page is open to admins, and to anyone while no admin exists yet
  // (so the first person can claim it even if Shopify did not say who the owner is).
  const canManageTeam = isAdmin || noAdminYet;
  const pages = new Set(member?.pages || []);
  const canOpen = (pageId) => {
    if (!pageId) return true;
    if (pageId === "team") return canManageTeam; // admin-only, even before enforcement
    if (!enforce) return true;
    if (isAdmin) return true;
    if (ADMIN_ONLY_PAGES.includes(pageId)) return false;
    if (OPEN_PAGES.includes(pageId)) return true;
    return pages.has(pageId);
  };
  const everyId = [...ASSIGNABLE_IDS, ...ADMIN_ONLY_PAGES, ...OPEN_PAGES];
  return { enforce, isAdmin, canManageTeam, member, identityError: identityError || null, canOpen, allowed: everyId.filter(canOpen) };
}

export async function getAccess({ request, shop, sessionToken }) {
  let enforce = false;
  let member = null;
  let identityError = null;
  let noAdminYet = false;
  try {
    const settings = await prisma.teamSettings.findUnique({ where: { shop } });
    noAdminYet = (await prisma.teamMember.count({ where: { shop, OR: [{ isAdmin: true }, { isOwner: true }] } })) === 0;
    enforce = !!settings?.enforce;
    const uid = sessionToken?.sub != null ? String(sessionToken.sub) : null;
    if (uid) member = await resolveMember({ shop, uid, idToken: getEncodedSessionToken(request) });
    else identityError = "Shopify did not say who is logged in";
  } catch (err) {
    identityError = String((err && err.message) || err);
    console.error("[teamAccess] could not identify the user:", err);
  }
  return buildAccess({ enforce, member, identityError, noAdminYet });
}

/**
 * Drop-in for authenticate.admin(request) that also checks the team access for
 * `pageId` (null = just identify the person). Returns the same object plus `access`.
 */
export async function authenticatePage(request, pageId) {
  const ctx = await authenticate.admin(request);
  const access = await getAccess({ request, shop: ctx.session.shop, sessionToken: ctx.sessionToken });
  if (pageId && !access.canOpen(pageId)) {
    if (request.method === "GET" || request.method === "HEAD") {
      throw ctx.redirect(`/app/no-access?page=${encodeURIComponent(pageId)}`);
    }
    throw Response.json({ ok: false, error: "You don't have access to this. Ask your admin." }, { status: 403 });
  }
  return { ...ctx, access };
}
