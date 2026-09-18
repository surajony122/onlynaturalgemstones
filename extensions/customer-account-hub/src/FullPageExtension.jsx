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
        <s-stack direction="inline" gap="small-100">
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
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
          {orders.map((order) => (
            <s-grid-item key={order.name} border="base" borderRadius="none" background="base" padding="base">
              <s-stack direction="block" gap="small-100">
                {order.image ? (
                  <s-image
                    src={order.image}
                    alt={order.name}
                    inlineSize="fill"
                    aspectRatio="1"
                    objectFit="cover"
                    borderRadius="none"
                  />
                ) : null}
                <s-text type="strong">{order.name}</s-text>
                {order.date ? <s-text color="subdued">{formatOrderDate(order.date)}</s-text> : null}
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
                {order.timeline ? <OrderTimeline steps={order.timeline} /> : null}
                {order.total ? <s-text color="subdued">{order.total}</s-text> : null}
                {order.statusUrl ? (
                  <s-button href={order.statusUrl} target="_blank" variant="primary" inlineSize="fill">
                    View order
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
