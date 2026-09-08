export default function AdditionalPage() {
  return (
    <s-page heading="Additional page" inlineSize="large">
      <s-section heading="Multiple pages">
        <s-paragraph>
          The app template comes with an additional page which demonstrates how
          to create multiple pages within app navigation using{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>
          .
        </s-paragraph>
        <s-paragraph>
          To create your own page and have it show up in the app navigation, add
          a page inside <code>app/routes</code>, and a link to it in the{" "}
          <code>NAV_ITEMS</code> list in{" "}
          <code>app/routes/app.jsx</code> (an in-app tab bar, not Shopify's own
          sidebar nav menu — this app deliberately keeps all its navigation
          inside its own pages instead).
        </s-paragraph>
      </s-section>
      {/* No slot="aside" -- keeps this page single-column/full-width like
          the rest of the app instead of splitting into two columns. */}
      <s-section heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              App nav best practices
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
