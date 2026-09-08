import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAttentionSummary } from "../utils/attention.server";
import { GlobalStyles } from "../components/table-kit";
import { AppShell } from "../components/app-shell";
import { ToastProvider } from "../components/toast";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Cheap, DB-only "does anything need attention" signal (see
  // attention.server.js) — drives the sidebar's badge counts/health dot
  // and the header's banner. Wrapped so a query hiccup here never takes
  // down every page in the app (this loader runs on every navigation).
  let attention = { items: [], badges: {}, healthy: true };
  try {
    attention = await getAttentionSummary();
  } catch (err) {
    console.error("[app.jsx] getAttentionSummary failed:", err);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", attention };
};

export default function App() {
  const { apiKey, attention } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <GlobalStyles />
      <ToastProvider>
        <AppShell attention={attention}>
          <Outlet />
        </AppShell>
      </ToastProvider>
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
