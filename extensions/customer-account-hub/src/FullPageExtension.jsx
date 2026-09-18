/**
 * Full-page Customer Account UI extension — a new "My Gemstone Hub" page
 * inside Shopify's hosted customer accounts (target
 * customer-account.page.render), showing the customer's recent orders,
 * saved wishlist, gem-recommendation reading, and read-only profile/
 * address summaries behind an in-page tab bar (Orders / Wishlist /
 * Recommendation / Profile / Address) instead of one long scroll.
 *
 * Orders/profile/addresses come straight from the Admin API (no separate
 * lead table); wishlist/recommendation come from this app's own database.
 * Profile and Address are READ-ONLY summaries with a button that jumps to
 * Shopify's own native edit pages via useNavigation() -- Shopify does not
 * let an extension render a custom editable profile/address form (only
 * inject a block into the native ones), so this is the closest a custom
 * page can get without duplicating Shopify's own PII-handling forms.
 *
 * This store uses Shopify's NEW hosted customer accounts (confirmed via
 * onlynaturalgemstones.com/account/login redirecting to
 * shopify.com/authentication/...), so there's no theme Liquid template to
 * edit for this — a UI extension is the only way to add custom content
 * here. See app/routes/public.customer-account-data.jsx for the backend
 * half of this (verifies the session token, looks up
 * WishlistLead/AstroLead by the signed-in customer's email, and reads
 * orders/profile/addresses live from the Admin API).
 *
 * IMPORTANT — after this extension is deployed and published, someone
 * still needs to add a link to it manually: Shopify Admin -> Settings ->
 * Customer accounts -> navigation. That step can't be automated from
 * code (confirmed via Shopify's own docs).
 *
 * IMPORTANT — reading the signed-in customer's identity (the `sub` claim
 * on the session token) requires this app to have "Protected customer
 * data access" approved in the Partner Dashboard (App setup -> Protected
 * customer data access). Without that, sessionToken.sub may come back
 * empty and this page will just show "not signed in".
 *
 * IMPORTANT — navigation.navigate() below uses Shopify's documented
 * 'shopify:customer-account/...' protocol (confirmed in Shopify's own
 * navigation-api docs for 'orders' and 'profile'). There is NO documented
 * path for a specific address's own edit form, only the built-in
 * addresses LIST page ('shopify:customer-account/addresses') -- every
 * "Manage address" button lands there and the customer picks which one
 * to edit. None of this has been click-tested against a real signed-in
 * session from this environment (no way to authenticate as a real
 * customer here) -- verify live once this is deployed.
 */
import '@shopify/ui-extensions/preact';
import {useNavigation} from '@shopify/ui-extensions/customer-account/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// This app's own backend — same Render domain used throughout the rest
// of this app (Interakt sends, /track routes, etc.).
const BACKEND_URL = 'https://shubh-gems-customizer-app.onrender.com/public/customer-account-data';

// The brand's own gemstone mark (shubh_gems_icon_final.svg), inlined as a
// data URI so it renders without needing a hosted asset URL -- s-icon only
// offers a fixed built-in icon set, no custom-SVG option, so this goes
// through s-image instead. Shown as a small mark leading the tab bar.
const BRAND_ICON_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyBjbGFzcz0ic2h1YmgtdXNwcy1pY29uLXN2ZyIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgNTAwIDUwMCIgZmlsbD0iI0E5NzczRiIgYXJpYS1sYWJlbD0iR2Vtc3RvbmUgaWNvbiI+CiAgPGcgZmlsbD0iI0E5NzczRiI+CiAgICA8cGF0aCBkPSJtMTg3LjMzNCA3Ni40MzVoLTM2Ljk1NWMtMi4wNzUgMC0zLjc1Ny0xLjY4LTMuNzU3LTMuNzU3czEuNjgyLTMuNzU3IDMuNzU3LTMuNzU3aDM2Ljk1NWMyLjA3NSAwIDMuNzU3IDEuNjggMy43NTcgMy43NTdzLTEuNjgzIDMuNzU3LTMuNzU3IDMuNzU3eiIvPgogICAgPHBhdGggZD0ibTI5NS4yNTkgMTQwLjc5NmMtLjg1NyAwLTEuNzE3LS4yOS0yLjQyMi0uODg4LTEuNTg3LTEuMzM5LTEuNzg1LTMuNzA5LS40NDgtNS4yOTRsNTIuMjQyLTYxLjg1NS0zNi4zMTctNDAuMjQ1aC0xMTYuNjMzbC0zNi4zMTcgNDAuMjQ1IDUyLjIzMSA2MS44NDRjMS4zMzggMS41ODUgMS4xMzkgMy45NTUtLjQ0OCA1LjI5NC0xLjU3OSAxLjM0My0zLjk1NyAxLjE0NS01LjI5NC0uNDQ0bC01NC4zNDYtNjQuMzVjLTEuMjEzLTEuNDM4LTEuMTc4LTMuNTQ4LjA4Mi00Ljk0MmwzOS42MzQtNDMuOTIxYy43MTItLjc4OSAxLjcyNS0xLjI0IDIuNzg5LTEuMjRoMTE5Ljk3M2MxLjA2NCAwIDIuMDc3LjQ1MSAyLjc4OCAxLjI0bDM5LjYzNCA0My45MjFjMS4yNiAxLjM5NCAxLjI5NSAzLjUwNC4wODMgNC45NDJsLTU0LjM1NyA2NC4zNjFjLS43NDQuODgtMS44MDYgMS4zMzItMi44NzQgMS4zMzJ6Ii8+CiAgICA8cGF0aCBkPSJtMzQ5LjYxOSA3Ni40MzVoLTM2Ljk1NmMtMi4wNzUgMC0zLjc1Ny0xLjY4LTMuNzU3LTMuNzU3czEuNjgyLTMuNzU3IDMuNzU3LTMuNzU3aDM2Ljk1NmMyLjA3NSAwIDMuNzU3IDEuNjggMy43NTcgMy43NTctLjAwMSAyLjA3Ny0xLjY4MyAzLjc1Ny0zLjc1NyAzLjc1N3oiLz4KICAgIDxwYXRoIGQ9Im0yNjYuNzQzIDE0MC43OTZjLS43NTQgMC0xLjUxNy0uMjI3LTIuMTc4LS42OTctMS42OS0xLjIwNy0yLjA4Mi0zLjU1MS0uODc3LTUuMjQzbDQ0LjExNi02MS44MzYtMzYuNTMtMzguNDAzLTE4LjIzNyAyNS4xMTFjLTEuNDEzIDEuOTQ0LTQuNjY3IDEuOTQ0LTYuMDc5IDBsLTE4LjIzNy0yNS4xMTEtMzYuNTI4IDM4LjQwMyA0NC4xMTIgNjEuODMzYzEuMjA1IDEuNjkxLjgxMyA0LjAzNi0uODc3IDUuMjQzLTEuNjkxIDEuMi00LjAzNi44MTEtNS4yMzktLjg3N2wtNDUuOTEzLTY0LjM1N2MtMS4wNDYtMS40NjgtLjkwNC0zLjQ2Ny4zMzYtNC43NzNsNDEuNzc2LTQzLjkyMWMuNzY4LS44MTEgMS44NzEtMS4yIDIuOTctMS4xNTkgMS4xMTMuMDczIDIuMTM3LjYzOCAyLjc5MiAxLjU0MWwxNy44NDggMjQuNTc1IDE3Ljg0OS0yNC41NzVjLjY1NS0uOTAzIDEuNjc4LTEuNDY4IDIuNzkyLTEuNTQxIDEuMTAxLS4wNDEgMi4yMDIuMzQ4IDIuOTcgMS4xNTlsNDEuNzc2IDQzLjkyMWMxLjI0IDEuMzA2IDEuMzgxIDMuMzA1LjMzNSA0Ljc3M2wtNDUuOTE3IDY0LjM2MWMtLjczMSAxLjAyNi0xLjg4NiAxLjU3My0zLjA2IDEuNTczeiIvPgogICAgPHBhdGggZD0ibTI0OS45OTggMTA4LjU3MWMtMS4xNSAwLTIuMjM4LS41MjgtMi45NS0xLjQzMWwtNTkuOTg2LTc2LjA1N2MtMS4yODQtMS42MjktMS4wMDUtMy45OTIuNjI0LTUuMjc2czMuOTkyLTEuMDA1IDUuMjc2LjYyNGw1Ny4wMzYgNzIuMzE1IDU3LjAzNy03Mi4zMTVjMS4yODgtMS42MjkgMy42NTEtMS45MDggNS4yNzYtLjYyNCAxLjYyOSAxLjI4NCAxLjkwOCAzLjY0Ny42MjQgNS4yNzZsLTU5Ljk4NyA3Ni4wNTdjLS43MTIuOTAzLTEuOCAxLjQzMS0yLjk1IDEuNDMxeiIvPgogICAgPHBhdGggZD0ibTI1MC4wNzQgNDc1Yy0yLjQyNyAwLTQuODU0LS4wNDgtNy4yOTQtLjE0My05MS41NTgtMy41ODEtMTY3LjIzNC03OC4wMTMtMTcyLjI4Mi0xNjkuNDUtNC4wMDEtNzIuNDc2IDM1LjQ5Mi0xMzkuODkgMTAwLjYxNC0xNzEuNzQzIDUuMTUxLTIuNTIgMTEuMTUzLTIuMjAxIDE2LjA1OS44NjYgNC45OTcgMy4xMTkgNy45ODIgOC40ODcgNy45ODIgMTQuMzYgMCA2LjM1OS0zLjY2NCAxMi4yNjItOS4zMzIgMTUuMDM5LTUwLjUzOCAyNC43NS04MS45MzEgNzUuMDU1LTgxLjkzMSAxMzEuMjg5IDAgMzkuODM4IDE1Ljc0MyA3Ny4wNjYgNDQuMzMgMTA0LjgyNSAyOC41NzQgMjcuNzQ4IDY2LjMyMyA0Mi40MzUgMTA2LjE3NiA0MS4yMTcgNzUuMzIyLTIuMjA4IDEzNy40NzQtNjIuODMxIDE0MS40OTYtMTM4LjAwNyAzLjE0Ni01OC43NTQtMjguOTA0LTExMy40MjktODEuNjUyLTEzOS4yOTUtNS43OTUtMi44NC05LjM5NC04LjYxOC05LjM5NC0xNS4wNzIgMC01Ljg3NyAyLjk4NS0xMS4yNDkgNy45ODYtMTQuMzcxIDQuODkyLTMuMDYgMTAuODc4LTMuMzgzIDE2LjAyMi0uODY1IDYyLjI1MyAzMC40MzQgMTAwLjkyNyA5Mi4zNDQgMTAwLjkyNyAxNjEuNTY5IDAgNDkuMzU1LTE5LjU5OCA5NS4zODItNTUuMTg1IDEyOS42MDItMzMuODEyIDMyLjUxMy03Ny43OTQgNTAuMTc5LTEyNC41MjIgNTAuMTc5em0tNzEuNzExLTMzNS41MThjLTEuMzM3IDAtMi42NzguMzA4LTMuOTUuOTMyLTYyLjQwMyAzMC41MjItMTAwLjI0NiA5NS4xMjUtOTYuNDEyIDE2NC41ODEgNC44MzggODcuNjA3IDc3LjM0NyAxNTguOTIxIDE2NS4wNzMgMTYyLjM1NSA0Ny40MjkgMS44NjggOTIuMjMyLTE1LjE3MSAxMjYuMzEzLTQ3Ljk0NiAzNC4wOTktMzIuNzg5IDUyLjg3OS03Ni44OTQgNTIuODc5LTEyNC4xODYgMC02Ni4zMzQtMzcuMDU5LTEyNS42NTgtOTYuNzE0LTE1NC44MTktMi44MzgtMS4zOS02LjAyNC0xLjIwMy04Ljc0NS40ODgtMi43ODcgMS43MzktNC40NDkgNC43MjUtNC40NDkgNy45OTEgMCAzLjU3IDEuOTg5IDYuNzY2IDUuMTkgOC4zMzYgNTUuNDU4IDI3LjE5IDg5LjE1NCA4NC42NzIgODUuODQ2IDE0Ni40NDItNC4yMjggNzkuMDQ3LTY5LjU4MSAxNDIuNzkyLTE0OC43NzkgMTQ1LjExOC00MS45NiAxLjE1NS04MS41ODgtMTQuMTY2LTExMS42MzEtNDMuMzQyLTMwLjA1Ni0yOS4xODYtNDYuNjA4LTY4LjMyNy00Ni42MDgtMTEwLjIxNSAwLTU5LjEyNSAzMy4wMDctMTEyLjAxNyA4Ni4xMzktMTM4LjA0IDMuMTE0LTEuNTIzIDUuMTI0LTQuNzc3IDUuMTI0LTguMjg4IDAtMy4yNjUtMS42NjItNi4yNDgtNC40NDctNy45ODctMS41MTItLjk0My0zLjE2OS0xLjQyLTQuODI5LTEuNDJ6Ii8+CiAgICA8cGF0aCBkPSJtMzA4LjgyIDE1NC44OTVoLTExNy42NDNjLTEuMTEgMC0yLjE2NS0uNDkxLTIuODc4LTEuMzQyLS43MTQtLjg1MS0xLjAxNS0xLjk3NC0uODIyLTMuMDY4LjA5My0uNTI1LjE2MS0xLjA1My4xNjEtMS41OTYgMC0zLjYyOC0yLjA0Mi02Ljg3NS01LjMyNy04LjQ3MS0xLjU3NC0uNzY3LTIuNDEyLTIuNTE3LTIuMDItNC4yMjMuMzkzLTEuNzA2IDEuOTEyLTIuOTEzIDMuNjYxLTIuOTEzaDEzMi4wNjZjMS43NDggMCAzLjI2NSAxLjIwNyAzLjY2IDIuOTEuMzk1IDEuNzAyLS40MzggMy40NTItMi4wMDggNC4yMjMtMy4yNzYgMS42MDMtNS4zMTEgNC44NDctNS4zMTEgOC40NjQgMCAuNTU0LjA3MSAxLjA5LjE2MyAxLjYxNS4xODkgMS4wOTMtLjExMiAyLjIxNi0uODI3IDMuMDY0LS43MTQuODQ2LTEuNzY1IDEuMzM3LTIuODc1IDEuMzM3em0tMTEzLjczNC03LjUxNGgxMDkuODI0Yy4yMDQtMi4zNDguODg2LTQuNTgzIDEuOTc2LTYuNTg2aC0xMTMuNzc3YzEuMDg5IDIuMDA0IDEuNzczIDQuMjM4IDEuOTc3IDYuNTg2eiIvPgogIDwvZz4KPC9zdmc+';

// 'heart' isn't in this surface's icon set, so wishlist uses the closest
// stand-in ('star-filled'); the rest map onto icons with literal meanings.
const TABS = [
  {key: 'orders', label: 'Orders', icon: 'order'},
  {key: 'wishlist', label: 'Wishlist', icon: 'star-filled'},
  {key: 'recommendation', label: 'Recommendation', icon: 'gift-card'},
  {key: 'profile', label: 'Profile', icon: 'profile'},
  {key: 'address', label: 'Address', icon: 'location'},
];

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [state, setState] = useState({status: 'loading', data: null, error: null});
  const [activeTab, setActiveTab] = useState('orders');
  const navigation = useNavigation();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setState({status: 'ready', data, error: null});
      } catch (err) {
        if (!cancelled) setState({status: 'error', data: null, error: String((err && err.message) || err)});
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <s-page heading="My Gemstone Hub">
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Loading" />
            <s-text>Loading your account…</s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (state.status === 'error') {
    return (
      <s-page heading="My Gemstone Hub">
        <s-section>
          <s-banner heading="Couldn't load your data" tone="critical">
            <s-text>{state.error}</s-text>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const {wishlist, recommendation, orders, profile, addresses} = state.data || {};

  return (
    <s-page heading="My Gemstone Hub" subheading={profile?.name ? `Welcome back, ${profile.name}` : undefined}>
      <s-section>
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <s-box inlineSize="28px" blockSize="28px">
            <s-image src={BRAND_ICON_DATA_URI} alt="Only Natural Gemstones" inlineSize="fill" aspectRatio="1" objectFit="contain" />
          </s-box>
          {TABS.map((tab) => (
            <s-button
              key={tab.key}
              variant={activeTab === tab.key ? 'primary' : 'secondary'}
              accessibilityLabel={tab.label}
              onClick={() => setActiveTab(tab.key)}
            >
              <s-icon type={tab.icon} />
            </s-button>
          ))}
        </s-stack>
      </s-section>

      {activeTab === 'orders' ? <OrdersSection orders={orders} /> : null}
      {activeTab === 'wishlist' ? <WishlistSection wishlist={wishlist} /> : null}
      {activeTab === 'recommendation' ? <RecommendationSection recommendation={recommendation} /> : null}
      {activeTab === 'profile' ? <ProfileSection profile={profile} navigation={navigation} /> : null}
      {activeTab === 'address' ? <AddressSection addresses={addresses} navigation={navigation} /> : null}
    </s-page>
  );
}

function OrdersSection({orders}) {
  return (
    <s-section heading="My Orders">
      {!orders || orders.length === 0 ? (
        <s-text>You haven't placed any orders yet.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          {orders.map((order) => (
            <OrderRow key={order.name} order={order} />
          ))}
        </s-stack>
      )}
    </s-section>
  );
}

// A compact summary row (name/date/status/total) plus a "View details"
// button that opens an s-modal with everything else: the full
// Placed->Delivered timeline, every line item broken into its gemstone +
// linked Gemstone Customisation charge line, and every property the
// customer filled in during customisation. Keeps the main list scannable
// while still surfacing the full bundle/customisation detail on demand.
function OrderRow({order}) {
  // s-modal has no boolean "open" prop -- it's shown/hidden via the
  // invoker-command pattern (a button's command/commandFor targeting the
  // modal's id), not an imperative ref call, which is what "View details"
  // not working traced back to.
  const modalId = `order-modal-${order.name.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const mainImage = order.bundles?.find((b) => b.image)?.image || '';

  return (
    <s-box border="base" borderRadius="none" background="base" padding="base">
      <s-stack direction="inline" gap="base">
        {mainImage ? (
          <s-box inlineSize="88px" blockSize="88px">
            <s-image src={mainImage} alt={order.name} inlineSize="fill" aspectRatio="1" objectFit="cover" borderRadius="none" />
          </s-box>
        ) : null}
        <s-stack direction="block" gap="small-100">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-text type="strong">{order.name}</s-text>
            {order.date ? <s-text color="subdued">{formatOrderDate(order.date)}</s-text> : null}
          </s-stack>
          <s-stack direction="inline" gap="small-100">
            {order.fulfillmentStatus ? (
              <s-badge tone={goodStatuses.has(order.fulfillmentStatus) ? 'auto' : 'critical'}>
                {formatStatusLabel(order.fulfillmentStatus)}
              </s-badge>
            ) : null}
            {order.financialStatus ? (
              <s-badge tone={goodStatuses.has(order.financialStatus) ? 'auto' : 'critical'}>
                {formatStatusLabel(order.financialStatus)}
              </s-badge>
            ) : null}
          </s-stack>
          {order.total ? <s-text type="strong">{order.total}</s-text> : null}
          <s-button variant="primary" command="--show" commandFor={modalId}>
            View details
          </s-button>
        </s-stack>
      </s-stack>

      <s-modal id={modalId} heading={order.name} size="large">
        <s-stack direction="block" gap="base">
          {order.timeline ? <OrderTimeline steps={order.timeline} /> : null}
          <s-stack direction="block" gap="small-100">
            {(order.bundles || []).map((bundle, i) => (
              <OrderBundleItem key={i} bundle={bundle} />
            ))}
          </s-stack>
          {order.total ? <s-text type="strong">{order.total}</s-text> : null}
        </s-stack>
        {order.statusUrl ? (
          <s-button slot="primary-action" href={order.statusUrl} target="_blank" variant="primary">
            View order
          </s-button>
        ) : null}
      </s-modal>
    </s-box>
  );
}

// One row per gemstone in the order: its own thumbnail/title/quantity,
// plus -- when it was customized -- every detail the customer filled in on
// the linked "Gemstone Customisation" charge line (Metal Type, Design
// Code, Size, Lab Certification, and Pooja/energisation wearer details
// when selected). Internal-only properties (the Linked Gemstone pairing
// key, the Setting SKU variant lookup) are already stripped server-side.
function OrderBundleItem({bundle}) {
  return (
    <s-box border="base" borderRadius="none" padding="base">
      <s-stack direction="inline" gap="base">
        {bundle.image ? (
          <s-box inlineSize="72px" blockSize="72px">
            <s-image src={bundle.image} alt={bundle.title} inlineSize="fill" aspectRatio="1" objectFit="cover" borderRadius="none" />
          </s-box>
        ) : null}
        <s-stack direction="block" gap="small-100">
          <s-text type="strong">
            {bundle.title}
            {bundle.quantity > 1 ? ` × ${bundle.quantity}` : ''}
          </s-text>
          {bundle.customisation && bundle.customisation.properties.length > 0 ? (
            <s-stack direction="block" gap="small-100">
              <s-text color="subdued">Gemstone Customisation</s-text>
              {bundle.customisation.properties.map((p) => (
                <s-text key={p.label} color="subdued">
                  {p.label}: {p.value}
                </s-text>
              ))}
            </s-stack>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function WishlistSection({wishlist}) {
  return (
    <s-section heading="My Wishlist">
      {!wishlist || !wishlist.items || wishlist.items.length === 0 ? (
        <s-text>You haven't saved any items to your wishlist yet.</s-text>
      ) : (
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
          {wishlist.items.map((item, i) => (
            <s-grid-item key={item.handle || i} border="base" borderRadius="none" background="base" padding="base">
              <s-stack direction="block" gap="small-100">
                {item.image ? (
                  <s-image
                    src={item.image}
                    alt={item.title || 'Product'}
                    inlineSize="fill"
                    aspectRatio="1"
                    objectFit="cover"
                    borderRadius="none"
                  />
                ) : null}
                <s-text type="strong">{item.title || 'Untitled product'}</s-text>
                {item.price ? <s-text color="subdued">{item.price}</s-text> : null}
                {item.handle ? (
                  <s-button
                    href={`https://onlynaturalgemstones.com/products/${item.handle}`}
                    target="_blank"
                    variant="primary"
                    inlineSize="fill"
                  >
                    View product
                  </s-button>
                ) : null}
              </s-stack>
            </s-grid-item>
          ))}
        </s-grid>
      )}
    </s-section>
  );
}

function RecommendationSection({recommendation}) {
  return (
    <s-section heading="My Gemstone Recommendation">
      {!recommendation ? (
        <s-text>You haven't submitted your birth details for a personalised gemstone recommendation yet.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
            <StoneRow label="Life Stone" stone={recommendation.life} />
            <StoneRow label="Benefic Stone" stone={recommendation.benefic} />
            <StoneRow label="Lucky Stone" stone={recommendation.lucky} />
          </s-grid>
          {recommendation.resultsUrl ? (
            <s-link href={recommendation.resultsUrl} target="_blank">
              View my full reading
            </s-link>
          ) : null}
        </s-stack>
      )}
    </s-section>
  );
}

// Read-only -- Shopify only lets an extension inject a block into its own
// native profile page, never render a full custom edit form, so "Edit
// profile" hands off to that native page via useNavigation() instead of
// duplicating it here.
function ProfileSection({profile, navigation}) {
  return (
    <s-section heading="Profile">
      {!profile ? (
        <s-text>Profile details aren't available right now.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          <s-grid-item border="base" borderRadius="none" background="base" padding="base">
            <s-stack direction="block" gap="small-100">
              {profile.name ? <s-text type="strong">{profile.name}</s-text> : null}
              {profile.email ? <s-text color="subdued">{profile.email}</s-text> : null}
              {profile.phone ? <s-text color="subdued">{profile.phone}</s-text> : null}
            </s-stack>
          </s-grid-item>
          <s-button variant="primary" onClick={() => navigation.navigate('shopify:customer-account/profile')}>
            Edit profile
          </s-button>
        </s-stack>
      )}
    </s-section>
  );
}

// Same read-only-summary-plus-handoff pattern as Profile -- see comment
// there for why this can't be a full custom edit form. Shopify's
// documented navigation targets only cover the built-in addresses LIST
// page (shopify:customer-account/addresses), not a deep link to one
// address's own edit form, so every "Manage address" button below lands
// on that same list -- the customer picks the address to edit once
// there. Flagged to the user: worth confirming live whether a future
// API version adds a per-address deep link.
function AddressSection({addresses, navigation}) {
  return (
    <s-section heading="Addresses">
      {!addresses || addresses.length === 0 ? (
        <s-text>You haven't saved any addresses yet.</s-text>
      ) : (
        <s-stack direction="block" gap="small-100">
          {addresses.map((addr, i) => (
            <s-grid-item key={i} border="base" borderRadius="none" background="base" padding="base">
              <s-stack direction="block" gap="small-100">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-text>{addr.text}</s-text>
                  {addr.isDefault ? <s-badge tone="auto">Default</s-badge> : null}
                </s-stack>
                <s-button variant="secondary" onClick={() => navigation.navigate('shopify:customer-account/addresses')}>
                  Manage address
                </s-button>
              </s-stack>
            </s-grid-item>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}

function StoneRow({label, stone}) {
  if (!stone || !stone.gem) return null;
  const product = stone.product;
  return (
    <s-grid-item border="base" borderRadius="none" background="base" padding="base">
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">{stone.gem}</s-text>
        {product && product.image ? (
          <s-image
            src={product.image}
            alt={product.title || stone.gem}
            inlineSize="fill"
            aspectRatio="1"
            objectFit="cover"
            borderRadius="none"
          />
        ) : null}
        {product ? <s-text type="strong">{product.title}</s-text> : null}
        {product && product.price ? <s-text color="subdued">{product.price}</s-text> : null}
        {product ? (
          <s-button
            href={`https://onlynaturalgemstones.com/products/${product.handle}`}
            target="_blank"
            variant="primary"
            inlineSize="fill"
          >
            View product
          </s-button>
        ) : null}
        {stone.collection ? (
          <s-link href={`https://onlynaturalgemstones.com/collections/${stone.collection}`} target="_blank">
            Browse collection
          </s-link>
        ) : null}
      </s-stack>
    </s-grid-item>
  );
}

// Placed -> Paid -> Shipped -> Delivered checklist for an order card: a
// filled checkmark for completed steps, an outline circle for steps not
// reached yet. One step per line (not a side-by-side row) so it stays
// legible on a narrow order card.
function OrderTimeline({steps}) {
  return (
    <s-stack direction="block" gap="small-100">
      {steps.map((step) => (
        <s-stack key={step.label} direction="inline" gap="small-100" alignItems="center">
          <s-icon type={step.done ? 'check-circle' : 'circle'} tone={step.done ? 'success' : 'neutral'} size="small" />
          <s-text color={step.done ? 'base' : 'subdued'}>{step.label}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

// Fulfillment/financial status values that read as "all good" get the
// neutral 'auto' badge tone; anything else (unfulfilled, refunded, voided,
// pending, etc.) gets 'critical' so it stands out as needing attention.
// s-badge only exposes these two tones on this surface.
const goodStatuses = new Set(['FULFILLED', 'PAID']);

function formatStatusLabel(status) {
  if (!status) return '';
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatOrderDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
  } catch {
    return '';
  }
}
