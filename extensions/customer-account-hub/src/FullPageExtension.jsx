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
const STORE_URL = 'https://onlynaturalgemstones.com';

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
  const items = (wishlist && wishlist.items) || [];

  return (
    <s-page
      heading={items.length ? `My Wishlist (${items.length})` : 'My Wishlist'}
      subheading={items.length ? 'Gemstones you saved to come back to' : undefined}
    >
      <s-section>
        {items.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-text>Your wishlist is empty.</s-text>
            <s-text color="subdued">Tap the heart on any gemstone to save it here.</s-text>
            <s-button variant="primary" href={`${STORE_URL}/collections/all`} target="_blank">
              Browse gemstones
            </s-button>
          </s-stack>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            {items.map((item, i) => (
              <WishlistCard key={item.handle || i} item={item} />
            ))}
          </s-grid>
        )}
      </s-section>
    </s-page>
  );
}

function WishlistCard({item}) {
  return (
    <s-box border="base" borderRadius="base" background="base" padding="base">
      <s-stack direction="block" gap="base">
        {item.image ? (
          <s-image
            src={item.image}
            alt={item.title || 'Gemstone'}
            inlineSize="fill"
            aspectRatio="1"
            objectFit="cover"
            borderRadius="base"
          />
        ) : null}
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{item.title || 'Gemstone'}</s-text>
          {item.price ? <s-text color="subdued">{item.price}</s-text> : null}
        </s-stack>
        {item.handle ? (
          <s-button variant="primary" inlineSize="fill" href={`${STORE_URL}/products/${item.handle}`} target="_blank">
            View product
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}
