import { Outlet, useLoaderData, useRouteError, NavLink } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Same 8 destinations that used to live in <s-app-nav> (Shopify's OWN
// sidebar, nested under the app's name in Shopify's admin chrome) --
// moved to an in-app tab bar instead, per explicit request. Shopify's
// sidebar now just shows this app as a single entry with no sub-items;
// clicking it lands on the root route (Jewelry Pricing) same as
// before, and every page navigates from here on out.
const NAV_ITEMS = [
  { href: "/app/overview", label: "Overview" },
  { href: "/app", label: "Jewelry Pricing", end: true },
  { href: "/app/astro-leads", label: "Astro Leads" },
  { href: "/app/wishlist-leads", label: "Wishlist Leads" },
  { href: "/app/whatsapp-events", label: "WhatsApp Events" },
  { href: "/app/server-health", label: "Server" },
  { href: "/app/settings", label: "Settings" },
  { href: "/app/additional", label: "Additional page" },
];

function InAppNav() {
  return (
    <nav
      style={{
        display: "flex",
        gap: "2px",
        overflowX: "auto",
        padding: "0 20px",
        background: "#ffffff",
        borderBottom: "1px solid #E5E7EB",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          to={item.href}
          end={item.end}
          style={({ isActive }) => ({
            padding: "12px 14px",
            fontSize: "13px",
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "#1E3A8A" : "#6B7280",
            borderBottom: isActive ? "2px solid #1E3A8A" : "2px solid transparent",
            textDecoration: "none",
            whiteSpace: "nowrap",
          })}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <InAppNav />
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
