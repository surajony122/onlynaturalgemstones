/**
 * Full-page Customer Account UI extension -- the "My Wishlist" page inside
 * Shopify's hosted customer accounts (target customer-account.page.render).
 *
 * This extension used to be a multi-tab "My Gemstone Hub" (Orders / Wishlist /
 * Recommendation / Profile / Address). It is now wishlist-only: the gem
 * recommendation lives in its own extension (customer-account-recommendation),
 * and orders/profile/addresses are Shopify's own native pages. The handle
 * "customer-account-hub" is kept on purpose so the link already added under
 * Shopify Admin -> Settings -> Customer accounts -> navigation keeps working.
 *
 * Data comes from this app's own backend (public.customer-account-data.jsx,
 * called with ?part=wishlist so it skips the orders/addresses lookup), which
 * verifies Shopify's signed session token before looking the wishlist up by
 * the signed-in customer's email.
 *
 * Needs "Protected customer data access" approved for this app in the Partner
 * Dashboard -- without it the session token's `sub` can come back empty.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BACKEND_URL = 'https://shubh-gems-customizer-app.onrender.com/public/customer-account-data?part=wishlist';

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
      <s-page heading="My Wishlist">
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Loading" />
            <s-text>Loading your wishlist…</s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (state.status === 'error') {
    return (
      <s-page heading="My Wishlist">
        <s-section>
          <s-banner heading="Couldn't load your wishlist" tone="critical">
            <s-text>{state.error}</s-text>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const {wishlist} = state.data || {};

  return (
    <s-page heading="My Wishlist">
      <WishlistSection wishlist={wishlist} />
    </s-page>
  );
}

function WishlistSection({wishlist}) {
  return (
    <s-section>
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
