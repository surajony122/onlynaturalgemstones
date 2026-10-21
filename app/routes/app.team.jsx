/**
 * Team access (admins only): every Shopify staff member who has opened the app
 * is listed here, and an admin ticks which app pages each person may open.
 * People can also be added by email before their first visit. Nothing is
 * blocked until "Turn on access control" is pressed, so the list can be filled
 * in first. The shop owner always has full access and cannot be restricted.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticatePage } from "../utils/teamAccess.server";
import { TEAM_PAGES, ASSIGNABLE_IDS } from "../utils/teamPages";
import { brand, Card, PageHeader, PageIn, Pill, tableWrapStyle, tableStyle, thStyle, tdStyle } from "../components/table-kit";
import { useToast } from "../components/toast";

// Opened like any other page: everyone can while access control is off, and afterwards only
// admins and people ticked for "Team access". Some things stay admin-only (see viewerIsAdmin).
async function adminGuard(request) {
  const ctx = await authenticatePage(request, "team");
  const shop = ctx.session.shop;
  const adminCount = await prisma.teamMember.count({ where: { shop, OR: [{ isAdmin: true }, { isOwner: true }] } });
  return { ...ctx, shop, adminCount, viewerIsAdmin: ctx.access.isAdmin };
}

export const loader = async ({ request }) => {
  const { shop, access, adminCount, viewerIsAdmin } = await adminGuard(request);
  const [members, settings] = await Promise.all([
    prisma.teamMember.findMany({ where: { shop }, orderBy: [{ isOwner: "desc" }, { lastSeenAt: "desc" }, { createdAt: "asc" }] }),
    prisma.teamSettings.findUnique({ where: { shop } }),
  ]);
  return {
    me: access.member ? access.member.id : null,
    canClaim: adminCount === 0 && !!access.member,
    viewerIsAdmin,
    enforce: !!settings?.enforce,
    identityError: access.identityError,
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      shopifyUserId: m.shopifyUserId,
      isOwner: m.isOwner,
      isAdmin: m.isAdmin,
      pages: m.pages || [],
      lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
    })),
  };
};

export const action = async ({ request }) => {
  const { shop, access, viewerIsAdmin } = await adminGuard(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const cleanPages = (raw) => {
    let arr = [];
    try { arr = JSON.parse(String(raw || "[]")); } catch { arr = []; }
    return [...new Set(arr.filter((id) => ASSIGNABLE_IDS.includes(id)))];
  };
  // an admin must always remain
  const otherAdmins = (excludeId) => prisma.teamMember.count({ where: { shop, id: { not: excludeId }, OR: [{ isAdmin: true }, { isOwner: true }] } });

  try {
    if (intent === "claimAdmin") {
      const adminCount = await prisma.teamMember.count({ where: { shop, OR: [{ isAdmin: true }, { isOwner: true }] } });
      if (adminCount > 0 || !access.member) return { ok: false, intent, error: "An admin already exists." };
      await prisma.teamMember.update({ where: { id: access.member.id }, data: { isAdmin: true } });
      return { ok: true, intent, message: "You are now an admin." };
    }
    if (intent === "setEnforce") {
      if (!viewerIsAdmin) return { ok: false, intent, error: "Only an admin can turn access control on or off." };
      const value = String(form.get("value")) === "true";
      await prisma.teamSettings.upsert({ where: { shop }, create: { shop, enforce: value }, update: { enforce: value } });
      return { ok: true, intent, message: value ? "Access control is ON. People now see only their pages." : "Access control is OFF. Everyone can open every page again." };
    }
    if (intent === "addMember") {
      // one or several emails (separated by new lines, commas, semicolons or spaces), all given the same pages
      const emails = [...new Set(String(form.get("emails") || form.get("email") || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const name = emails.length === 1 ? String(form.get("name") || "").trim() || null : null;
      const pages = cleanPages(form.get("pages"));
      if (!emails.length) return { ok: false, intent, error: "Enter at least one email address." };
      const bad = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (bad.length) return { ok: false, intent, error: `Not a valid email: ${bad.slice(0, 3).join(", ")}` };
      let added = 0;
      const skipped = [];
      for (const email of emails) {
        const exists = await prisma.teamMember.findFirst({ where: { shop, email: { equals: email, mode: "insensitive" } } });
        if (exists) { skipped.push(email); continue; }
        await prisma.teamMember.create({ data: { shop, email, name, pages } });
        added++;
      }
      if (!added) return { ok: false, intent, error: "Already on the list: " + skipped.join(", ") };
      return { ok: true, intent, message: `${added} added${skipped.length ? `, ${skipped.length} already on the list` : ""}. They are matched when they next open the app.` };
    }
    const id = String(form.get("id") || "");
    const target = id ? await prisma.teamMember.findFirst({ where: { id, shop } }) : null;
    if (!target) return { ok: false, intent, error: "That person was not found." };
    if (intent === "saveMember") {
      if (target.isOwner) return { ok: false, intent, error: "The shop owner always has full access." };
      if (!viewerIsAdmin && target.isAdmin) return { ok: false, intent, error: "Only an admin can change an admin's access." };
      if (!viewerIsAdmin && access.member && target.id === access.member.id) return { ok: false, intent, error: "Ask an admin to change your own access." };
      const isAdmin = viewerIsAdmin ? String(form.get("isAdmin")) === "true" : target.isAdmin;
      if (target.isAdmin && !isAdmin && (await otherAdmins(target.id)) === 0) return { ok: false, intent, error: "There must be at least one admin." };
      await prisma.teamMember.update({ where: { id: target.id }, data: { pages: cleanPages(form.get("pages")), isAdmin } });
      return { ok: true, intent, message: "Saved." };
    }
    if (intent === "removeMember") {
      if (target.isOwner) return { ok: false, intent, error: "The shop owner can't be removed." };
      if (!viewerIsAdmin && target.isAdmin) return { ok: false, intent, error: "Only an admin can remove an admin." };
      if (access.member && target.id === access.member.id) return { ok: false, intent, error: "You can't remove yourself." };
      if ((target.isAdmin) && (await otherAdmins(target.id)) === 0) return { ok: false, intent, error: "There must be at least one admin." };
      await prisma.teamMember.delete({ where: { id: target.id } });
      return { ok: true, intent, message: "Removed. If they open the app again they will be listed with no access." };
    }
  } catch (err) {
    return { ok: false, intent, error: String((err && err.message) || err) };
  }
  return { ok: false, intent, error: "Unknown action" };
};

const smallBtn = { padding: "6px 12px", borderRadius: "8px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "12px", fontWeight: 600, cursor: "pointer" };
const primaryBtn = { ...smallBtn, border: `1px solid ${brand.accent}`, background: brand.accent, color: "#fff" };

function MemberRow({ m, isMe, enforce, viewerIsAdmin }) {
  const fetcher = useFetcher();
  const toast = useToast();
  const [pages, setPages] = useState(m.pages);
  const [isAdmin, setIsAdmin] = useState(m.isAdmin);
  useEffect(() => { setPages(m.pages); setIsAdmin(m.isAdmin); }, [m.pages.join(","), m.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = fetcher.state === "idle" ? fetcher.data : null;
  useEffect(() => {
    if (!res) return;
    toast.show(res.ok ? res.message || "Done" : res.error || "Could not save", { isError: !res.ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const busy = fetcher.state !== "idle";
  // the owner is always locked; people who may manage the team but are not admins cannot edit admins or themselves
  const locked = m.isOwner || (!viewerIsAdmin && (m.isAdmin || isMe));
  const dirty = isAdmin !== m.isAdmin || [...pages].sort().join(",") !== [...m.pages].sort().join(",");
  const toggle = (id) => setPages((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => fetcher.submit({ intent: "saveMember", id: m.id, pages: JSON.stringify(pages), isAdmin: String(isAdmin) }, { method: "post" });
  const remove = () => window.confirm(`Remove ${m.email || m.name || "this person"} from the list?`) && fetcher.submit({ intent: "removeMember", id: m.id }, { method: "post" });

  return (
    <tr className="dt-row">
      <td style={{ ...tdStyle, minWidth: "210px" }}>
        <div style={{ fontWeight: 600, color: brand.ink }}>{m.name || (m.email ? m.email.split("@")[0] : "Unknown user")}</div>
        <div style={{ fontSize: "11.5px", color: brand.muted, wordBreak: "break-all" }}>{m.email || (m.shopifyUserId ? `Shopify user ${m.shopifyUserId} (email not available)` : "Invited, has not opened the app yet")}</div>
        <div style={{ marginTop: "4px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {isMe && <Pill label="You" active color={brand.accent} />}
          {m.isOwner && <Pill label="Shop owner" active color="#7b5ea7" />}
          {!m.isOwner && m.isAdmin && <Pill label="Admin" active color="#b06000" />}
          {!m.shopifyUserId && <Pill label="Not opened yet" color={brand.muted} />}
        </div>
        <div style={{ fontSize: "11px", color: brand.faint, marginTop: "4px" }}>{m.lastSeenAt ? `Last opened ${new Date(m.lastSeenAt).toLocaleString()}` : "Never opened"}</div>
      </td>
      <td style={{ ...tdStyle, minWidth: "340px" }}>
        {locked ? (
          <span style={{ fontSize: "12.5px", color: brand.body }}>{m.isOwner ? "Full access (shop owner)" : m.isAdmin ? "Full access (admin)" : "Only an admin can change your own access"}</span>
        ) : isAdmin ? (
          <span style={{ fontSize: "12.5px", color: brand.body }}>Full access (admin)</span>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
              {TEAM_PAGES.map((p) => {
                const on = pages.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} disabled={busy}
                    style={{ padding: "4px 10px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? brand.accent : brand.border}`, background: on ? brand.accentTint : "#fff", color: on ? brand.accent : brand.muted }}>
                    {on ? "✓ " : ""}{p.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        {!locked && viewerIsAdmin && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: brand.body, cursor: "pointer" }}>
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} disabled={busy || isMe} />
            Admin
          </label>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
        {!locked && <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...primaryBtn, opacity: busy || !dirty ? 0.5 : 1, marginRight: "6px" }}>{busy ? "Saving…" : "Save"}</button>}
        {!locked && !isMe && <button type="button" onClick={remove} disabled={busy} style={smallBtn}>Remove</button>}
      </td>
    </tr>
  );
}

export default function TeamPage() {
  const { members, enforce, me, canClaim, identityError, viewerIsAdmin } = useLoaderData();
  const fetcher = useFetcher();
  const toast = useToast();
  const [emails, setEmails] = useState("");
  const [name, setName] = useState("");
  const [newPages, setNewPages] = useState([]);
  const res = fetcher.state === "idle" ? fetcher.data : null;
  useEffect(() => {
    if (!res) return;
    toast.show(res.ok ? res.message || "Done" : res.error || "Could not save", { isError: !res.ok });
    if (res.ok && res.intent === "addMember") { setEmails(""); setName(""); setNewPages([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const busy = fetcher.state !== "idle";
  const setEnforce = (value) => {
    const msg = value
      ? "Turn on access control? From now on each person sees only the pages ticked for them. Make sure you (and your team) are set up first. Admins and the shop owner always keep full access."
      : "Turn access control off? Everyone will be able to open every page again.";
    if (window.confirm(msg)) fetcher.submit({ intent: "setEnforce", value: String(value) }, { method: "post" });
  };

  return (
    <PageIn>
      <PageHeader
        title="Team access"
        description="Everyone who has opened the app is listed here. Choose which pages each person may open."
        stats={[{ label: "People", value: members.length }, { label: "Access control", value: enforce ? "ON" : "OFF", tone: enforce ? "success" : undefined }]}
        info={<p style={{ margin: 0 }}>People appear here the first time they open the app from their own Shopify login. They start with no pages. Nothing is blocked until you turn access control on. The shop owner and admins always see everything; Settings and System Health are admin-only. Team access is a page like the others: tick it for anyone who may manage the team (they can assign pages to others, but only admins can make admins or turn access control on).</p>}
      />

      {identityError && (
        <Card style={{ marginBottom: "16px", background: "#fff8ec", borderColor: "#e8c98a" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body }}>The app could not identify who you are ({String(identityError).slice(0, 120)}). Names and emails may be missing.</p>
        </Card>
      )}
      {canClaim && (
        <Card style={{ marginBottom: "16px", background: "#eef7ef", borderColor: "#b9dcbf" }}>
          <p style={{ margin: "0 0 8px", fontSize: "13px", color: brand.body }}>No admin has been set yet. The first admin is normally the shop owner, found automatically. If that has not happened, you can make yourself the admin.</p>
          <button type="button" disabled={busy} style={primaryBtn} onClick={() => fetcher.submit({ intent: "claimAdmin" }, { method: "post" })}>Make me admin</button>
        </Card>
      )}

      <Card style={{ marginBottom: "16px", background: enforce ? "#eef7ef" : "#fff8ec", borderColor: enforce ? "#b9dcbf" : "#e8c98a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: "13px", color: brand.body, maxWidth: "640px" }}>
            {enforce
              ? "Access control is ON: each person sees only the pages ticked for them."
              : "Access control is OFF: everyone can still open every page. Fill in the list below, then turn it on."}
          </p>
          {viewerIsAdmin ? (
            <button type="button" disabled={busy} style={enforce ? smallBtn : primaryBtn} onClick={() => setEnforce(!enforce)}>
              {enforce ? "Turn off access control" : "Turn on access control"}
            </button>
          ) : (
            <span style={{ fontSize: "12px", color: brand.muted }}>Only an admin can change this.</span>
          )}
        </div>
      </Card>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Person</th>
              <th style={thStyle}>Pages they can open</th>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr><td style={tdStyle} colSpan={4}>No one yet. People appear here when they open the app.</td></tr>
            ) : (
              members.map((m) => <MemberRow key={m.id} m={m} isMe={m.id === me} enforce={enforce} viewerIsAdmin={viewerIsAdmin} />)
            )}
          </tbody>
        </table>
      </div>

      <Card style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: brand.ink, marginBottom: "8px" }}>Add people by email</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder={"Their Shopify login emails: one per line, or separated by commas"} style={{ padding: "8px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px", minWidth: "300px", fontFamily: "inherit", resize: "vertical" }} />
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional, for one person)" style={{ padding: "8px 12px", borderRadius: "9px", border: `1px solid ${brand.border}`, fontSize: "13px", minWidth: "230px" }} />
        </div>
        <div style={{ fontSize: "12px", color: brand.muted, margin: "10px 0 6px" }}>Pages they can open:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {TEAM_PAGES.map((pg) => {
            const on = newPages.includes(pg.id);
            return (
              <button key={pg.id} type="button" onClick={() => setNewPages((cur) => (cur.includes(pg.id) ? cur.filter((x) => x !== pg.id) : [...cur, pg.id]))} disabled={busy}
                style={{ padding: "4px 10px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? brand.accent : brand.border}`, background: on ? brand.accentTint : "#fff", color: on ? brand.accent : brand.muted }}>
                {on ? "✓ " : ""}{pg.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: "10px" }}>
          <button type="button" disabled={busy || !emails.trim()} style={{ ...primaryBtn, padding: "8px 14px", fontSize: "13px", opacity: busy || !emails.trim() ? 0.5 : 1 }} onClick={() => fetcher.submit({ intent: "addMember", emails, name, pages: JSON.stringify(newPages) }, { method: "post" })}>Add</button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: brand.muted }}>Everyone listed gets the pages ticked above; you can change each person afterwards. They also need a Shopify staff account that is allowed to open this app (Shopify admin → Settings → Users).</p>
      </Card>
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
