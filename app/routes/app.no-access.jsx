/**
 * Shown when someone opens an app page they have not been given access to
 * (Team access, see app.team.jsx). Lists the pages they can open instead.
 */
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticatePage } from "../utils/teamAccess.server";
import { TEAM_PAGES } from "../utils/teamPages";
import { brand, Card, PageHeader, PageIn } from "../components/table-kit";

const ROUTES = {
  overview: "/app/overview", astro: "/app/astro-leads", wishlist: "/app/wishlist-leads", contact: "/app/contact-leads", invoices: "/app/invoices",
  pricing: "/app/pricing", gemdetails: "/app/gemstone-details", currency: "/app/currency-countries", designimages: "/app/design-images", whatsapp: "/app/whatsapp-events",
};

export const loader = async ({ request }) => {
  const { access } = await authenticatePage(request, null);
  const m = access.member;
  return {
    who: m ? { name: m.name, email: m.email } : null,
    pages: TEAM_PAGES.filter((p) => access.allowed.includes(p.id)).map((p) => ({ id: p.id, label: p.label, to: ROUTES[p.id] })),
  };
};

export default function NoAccessPage() {
  const { who, pages } = useLoaderData();
  return (
    <PageIn>
      <PageHeader title="No access to this page" description="Your account has not been given access to this page yet." />
      <Card>
        <p style={{ margin: "0 0 10px", fontSize: "13.5px", color: brand.body }}>
          Ask your admin to add this page for you{who?.email ? <> (you are signed in as <strong>{who.email}</strong>)</> : null}.
        </p>
        {pages.length > 0 ? (
          <>
            <div style={{ fontSize: "12.5px", color: brand.muted, marginBottom: "8px" }}>Pages you can open:</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {pages.map((p) => (
                <Link key={p.id} to={p.to} style={{ padding: "6px 14px", borderRadius: "9px", border: `1px solid ${brand.border}`, color: brand.accent, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>{p.label}</Link>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: "12.5px", color: brand.muted }}>You have no pages yet.</div>
        )}
      </Card>
    </PageIn>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
