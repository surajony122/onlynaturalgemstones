/**
 * Full-page Customer Account UI extension — a new "My Gemstone Hub" page
 * inside Shopify's hosted customer accounts (target
 * customer-account.page.render), showing the customer's recent orders,
 * saved wishlist, and their gem-recommendation reading side by side.
 * Orders come straight from the Admin API (no separate lead table), since
 * Shopify's native order-history page can't be redesigned from an
 * extension -- only supplemented with fixed injection-point blocks -- so
 * this page is a fully custom alternative rather than a reskin of it.
 *
 * This store uses Shopify's NEW hosted customer accounts (confirmed via
 * onlynaturalgemstones.com/account/login redirecting to
 * shopify.com/authentication/...), so there's no theme Liquid template to
 * edit for this — a UI extension is the only way to add custom content
 * here. See app/routes/public.customer-account-data.jsx for the backend
 * half of this (verifies the session token, looks up
 * WishlistLead/AstroLead by the signed-in customer's email).
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
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// This app's own backend — same Render domain used throughout the rest
// of this app (Interakt sends, /track routes, etc.).
const BACKEND_URL = 'https://shubh-gems-customizer-app.onrender.com/public/customer-account-data';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [state, setState] = useState({status: 'loading', data: null, error: null});

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
            <s-text>Loading your wishlist and recommendations…</s-text>
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

  const {wishlist, recommendation, orders} = state.data || {};

  return (
    <s-page heading="My Gemstone Hub" subheading="Your saved items and personalised gemstone recommendation">
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

      <s-section heading="My Wishlist">
        {!wishlist || !wishlist.items || wishlist.items.length === 0 ? (
          <s-text>You haven't saved any items to your wishlist yet.</s-text>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
            {wishlist.items.map((item, i) => (
              <s-grid-item
                key={item.handle || i}
                border="base"
                borderRadius="none"
                background="base"
                padding="base"
              >
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

      <s-section heading="My Gemstone Recommendation">
        {!recommendation ? (
          <s-text>
            You haven't submitted your birth details for a personalised gemstone recommendation yet.
          </s-text>
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
    </s-page>
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
        {product ? (
          <s-text type="strong">{product.title}</s-text>
        ) : null}
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
