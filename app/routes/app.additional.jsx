import { brand, Card, PageHeader, PageIn } from "../components/table-kit";

export default function AdditionalPage() {
  return (
    <PageIn>
      <PageHeader title="Additional page" />
      <Card style={{ marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 10px", color: brand.ink }}>Multiple pages</h2>
        <p style={{ fontSize: "13.5px", color: brand.body, lineHeight: 1.6, margin: "0 0 10px" }}>
          The app template comes with an additional page which demonstrates how to create multiple pages within app
          navigation using{" "}
          <a href="https://shopify.dev/docs/apps/tools/app-bridge" target="_blank" rel="noreferrer" style={{ color: brand.accent }}>
            App Bridge
          </a>
          .
        </p>
        <p style={{ fontSize: "13.5px", color: brand.body, lineHeight: 1.6, margin: 0 }}>
          To create your own page and have it show up in the app navigation, add a page inside{" "}
          <code>app/routes</code>, and a link to it in the <code>NAV_GROUPS</code> list in{" "}
          <code>app/components/app-shell.jsx</code> (the sidebar this app builds itself, not Shopify's own sidebar
          nav menu — this app deliberately keeps all its navigation inside its own pages instead).
        </p>
      </Card>
      <Card>
        <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 10px", color: brand.ink }}>Resources</h2>
        <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13.5px", color: brand.body, lineHeight: 1.8 }}>
          <li>
            <a href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav" target="_blank" rel="noreferrer" style={{ color: brand.accent }}>
              App nav best practices
            </a>
          </li>
        </ul>
      </Card>
    </PageIn>
  );
}
