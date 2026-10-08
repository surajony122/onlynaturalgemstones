/**
 * Full-page Customer Account UI extension -- the "My Gemstone Recommendation"
 * page inside Shopify's hosted customer accounts (target
 * customer-account.page.render).
 *
 * Laid out like the storefront's own gemstone recommendation result page:
 * one card per stone (Life / Benefic / Lucky) with the collection's category
 * photo, the stone's English + Hindi name, its planet, the spec rows (weight,
 * metal, finger, day, mantra, substitute) and a "Buy <stone>" button, then a
 * link to the full reading. Customer account extensions can only use Shopify's
 * own components, so this matches the results page's structure and content,
 * not its exact fonts and colours.
 *
 * Data comes from this app's backend (public.customer-account-data.jsx,
 * called with ?part=recommendation), which verifies Shopify's signed session
 * token and reads the customer's custom.astro_advice metafield (falling back
 * to the app database).
 *
 * Needs "Protected customer data access" approved for this app in the Partner
 * Dashboard -- without it the session token's `sub` can come back empty.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BACKEND_URL = 'https://shubh-gems-customizer-app.onrender.com/public/customer-account-data?part=recommendation';
const STORE_URL = 'https://onlynaturalgemstones.com';

// Same English -> Hindi names the storefront result page shows next to a stone.
const HINDI_NAMES = {
  ruby: 'Manik',
  pearl: 'Moti',
  'red coral': 'Moonga',
  emerald: 'Panna',
  'yellow sapphire': 'Pukhraj',
  diamond: 'Heera',
  'blue sapphire': 'Neelam',
  hessonite: 'Gomed',
  "cat's eye": 'Lehsunia',
  'cats eye': 'Lehsunia',
  opal: 'Upal',
};

// Colour-coding that mirrors the recommendation email: Life amber, Benefic
// blue, Lucky green (badge tones are the closest the component set offers).
const CARDS = [
  {key: 'life', label: 'Life Stone', tone: 'warning'},
  {key: 'benefic', label: 'Benefic Stone', tone: 'info'},
  {key: 'lucky', label: 'Lucky Stone', tone: 'success'},
];

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

  if (!recommendation) {
    return (
      <s-page heading="My Gemstone Recommendation">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>You haven't received a personalised gemstone recommendation yet.</s-text>
            <s-text color="subdued">
              Share your birth details and we'll match the Life, Benefic and Lucky stones to your birth chart.
            </s-text>
            <s-button variant="primary" href={`${STORE_URL}/pages/gemstone-recommendation`} target="_blank">
              Get my recommendation
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const meta = recommendation.meta || {};
  return (
    <s-page
      heading="My Gemstone Recommendation"
      subheading={meta.name ? `Prepared for ${meta.name}` : 'Based on your birth chart'}
    >
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {CARDS.map((card) =>
            recommendation[card.key] && recommendation[card.key].gem ? (
              <StoneCard key={card.key} label={card.label} tone={card.tone} stone={recommendation[card.key]} />
            ) : null
          )}
        </s-grid>
      </s-section>

      {recommendation.resultsUrl ? (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button variant="secondary" href={recommendation.resultsUrl} target="_blank">
              View my full reading
            </s-button>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

function StoneCard({label, tone, stone}) {
  const hindi = HINDI_NAMES[String(stone.gem || '').toLowerCase().trim()] || '';
  const image = stone.image || (stone.product && stone.product.image) || '';
  const specs = [
    ['Weight', stone.weightCarat ? `${stone.weightCarat} Carat` : null],
    ['Metal', stone.wearMetal],
    ['Finger', stone.wearFinger],
    ['Day', stone.wearDay],
    ['Mantra', stone.mantra],
    ['Substitute', stone.substitute],
  ].filter(([, value]) => value);

  return (
    <s-box border="base" borderRadius="base" background="base" padding="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-100" alignItems="center" justifyContent="space-between">
          <s-badge tone={tone}>{label}</s-badge>
          {stone.planet ? <s-text color="subdued">for {stone.planet}</s-text> : null}
        </s-stack>

        {image ? (
          <s-image src={image} alt={stone.gem} inlineSize="fill" aspectRatio="1" objectFit="cover" borderRadius="base" />
        ) : null}

        <s-stack direction="block" gap="none">
          <s-heading>{hindi ? `${stone.gem} (${hindi})` : stone.gem}</s-heading>
        </s-stack>

        <s-stack direction="block" gap="small-200">
          {specs.map(([name, value]) => (
            <s-stack key={name} direction="inline" gap="base" justifyContent="space-between">
              <s-text color="subdued">{name}</s-text>
              <s-text type="strong">{value}</s-text>
            </s-stack>
          ))}
        </s-stack>

        {stone.collection ? (
          <s-button variant="primary" inlineSize="fill" href={`${STORE_URL}/collections/${stone.collection}`} target="_blank">
            Buy {stone.gem}
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}
