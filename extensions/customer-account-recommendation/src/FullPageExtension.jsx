/**
 * Full-page Customer Account UI extension -- the "My Gemstone Recommendation"
 * page inside Shopify's hosted customer accounts (target
 * customer-account.page.render).
 *
 * Split out of the old combined "My Gemstone Hub" extension
 * (customer-account-hub, now wishlist-only). Shows the customer's latest saved
 * gem recommendation -- Life, Benefic and Lucky stone cards plus a link to the
 * full reading -- read from this app's own backend
 * (public.customer-account-data.jsx, called with ?part=recommendation so it
 * skips the orders/addresses lookup). The backend verifies Shopify's signed
 * session token, then finds the latest recommendation by the signed-in
 * customer's email.
 *
 * Needs "Protected customer data access" approved for this app in the Partner
 * Dashboard -- without it the session token's `sub` can come back empty.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BACKEND_URL = 'https://shubh-gems-customizer-app.onrender.com/public/customer-account-data?part=recommendation';

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
      <s-page heading="My Gemstone Recommendation">
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Loading" />
            <s-text>Loading your recommendation…</s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (state.status === 'error') {
    return (
      <s-page heading="My Gemstone Recommendation">
        <s-section>
          <s-banner heading="Couldn't load your recommendation" tone="critical">
            <s-text>{state.error}</s-text>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const {recommendation} = state.data || {};

  return (
    <s-page heading="My Gemstone Recommendation">
      <RecommendationSection recommendation={recommendation} />
    </s-page>
  );
}

function RecommendationSection({recommendation}) {
  return (
    <s-section>
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
