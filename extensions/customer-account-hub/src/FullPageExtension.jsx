/**
 * Full-page Customer Account UI extension — a new "My Gemstone Hub" page
 * inside Shopify's hosted customer accounts (target
 * customer-account.page.render), showing the customer's saved wishlist
 * and their gem-recommendation reading side by side.
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

  const {wishlist, recommendation} = state.data || {};

  return (
    <s-page heading="My Gemstone Hub" subheading="Your saved items and personalised gemstone recommendation">
      <s-section heading="My Wishlist">
        {!wishlist || !wishlist.items || wishlist.items.length === 0 ? (
          <s-text>You haven't saved any items to your wishlist yet.</s-text>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(140px, 1fr))" gap="base">
            {wishlist.items.map((item, i) => (
              <s-grid-item key={item.handle || i}>
                <s-stack direction="block" gap="small-100">
                  {item.image ? (
                    <s-product-thumbnail src={item.image} alt={item.title || 'Product'} />
                  ) : null}
                  <s-text>{item.title || 'Untitled product'}</s-text>
                  {item.price ? <s-text color="subdued">{item.price}</s-text> : null}
                  {item.handle ? (
                    <s-link href={`https://onlynaturalgemstones.com/products/${item.handle}`} target="_blank">
                      View product
                    </s-link>
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
            <StoneRow label="Life Stone" stone={recommendation.life} />
            <StoneRow label="Benefic Stone" stone={recommendation.benefic} />
            <StoneRow label="Lucky Stone" stone={recommendation.lucky} />
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
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-text type="strong">{label}:</s-text>
      <s-text>{stone.gem}</s-text>
      {stone.collection ? (
        <s-link href={`https://onlynaturalgemstones.com/collections/${stone.collection}`} target="_blank">
          Browse collection
        </s-link>
      ) : null}
    </s-stack>
  );
}
