/**
 * In-app reference for every page and Settings section in ONG Controls —
 * what each one does, which messages send automatically vs. manually,
 * and an FAQ covering the questions that come up most when setting a
 * section up for the first time. Static content (no loader/action) —
 * built entirely from the same Card/PageHeader/Icon/brand components
 * every other page here already uses, so it reads as part of the app
 * rather than a separate document dropped into it.
 */
import { useState } from "react";
import { brand, Icon, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";

const hintStyle = { fontSize: "13px", color: brand.body, lineHeight: 1.6, margin: "0 0 10px" };

// One collapsible group of pages, matching the sidebar's own grouping
// (Home / Catalog / Leads / Messaging / Orders / System) — same
// TemplateCard shape used throughout Settings, so this reads as one more
// section of the same app rather than a different design.
function GroupCard({ icon, title, navPath, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card padding="0" style={{ marginBottom: "14px", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          width: "100%",
          padding: "16px 20px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", color: brand.ink, minWidth: 0 }}>
          <Icon name={icon} size={17} color={brand.accent} />
          {title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "11.5px", color: brand.faint, fontFamily: brand.mono }}>{navPath}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={brand.muted} style={{ flexShrink: 0 }} />
        </span>
      </button>
      {open && <div style={{ padding: "0 20px 18px" }}>{children}</div>}
    </Card>
  );
}

// One page's own entry inside a GroupCard — name, route, one-line
// purpose, and the bullet list of what it actually does.
function PageEntry({ title, route, purpose, points, tags }) {
  return (
    <div style={{ padding: "14px 0", borderTop: `1px solid ${brand.divider}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
        <span style={{ fontSize: "14px", color: brand.ink }}>{title}</span>
        <code style={{ fontFamily: brand.mono, fontSize: "11px", color: brand.accent, background: brand.accentTint, padding: "2px 7px", borderRadius: "5px" }}>{route}</code>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: "13px", color: brand.muted, fontStyle: "italic" }}>{purpose}</p>
      <ul style={{ margin: "0 0 10px", paddingLeft: "18px" }}>
        {points.map((p, i) => (
          <li key={i} style={{ fontSize: "13px", color: brand.body, lineHeight: 1.65, marginBottom: "4px" }}>
            {p}
          </li>
        ))}
      </ul>
      {tags && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {tags.map((t) => (
            <Pill key={t} label={t} active color={brand.accent} />
          ))}
        </div>
      )}
    </div>
  );
}

// FAQ item — same <details>/summary shape as Settings' own Explain
// component, just with a question instead of a "how do I set this up"
// blurb, so the whole page shares one interaction pattern.
function FaqItem({ q, children }) {
  return (
    <details style={{ padding: "14px 0", borderTop: `1px solid ${brand.divider}` }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "14px", color: brand.ink, listStyle: "none" }}>
        <Icon name="help-circle" size={15} color={brand.accent} style={{ flexShrink: 0, marginTop: "2px" }} />
        {q}
      </summary>
      <div style={{ marginTop: "8px", marginLeft: "23px", fontSize: "13.5px", color: brand.body, lineHeight: 1.65, maxWidth: "62ch" }}>{children}</div>
    </details>
  );
}

const SETTINGS_ROWS = [
  ["Gmail", "SMTP address + app password used to send every email in this app", "Email"],
  ["Google Sheets", "Service account + spreadsheet ID for the leads backup mirror", "—"],
  ["Location Autocomplete", "Google Places API key powering the “Place of Birth” field on the astrology form", "—"],
  ["WhatsApp (Interakt)", "Interakt API key — the shared connection every WhatsApp template below sends through", "WhatsApp"],
  ["Gem Recommendation", "WhatsApp template name + test send, for the astrology result message", "WhatsApp"],
  ["Gem Recommendation — Email", "Subject + full HTML template for the same recommendation, by email", "Email"],
  ["Order Processing", "Trigger tag + WhatsApp template for “your order is being prepared”", "WhatsApp"],
  ["Order Processing — Email", "Subject + template for the same message, by email", "Email"],
  ["Return & Refund WhatsApp", "Two template names (Return Received, Refund Processed) + a test send for each", "WhatsApp"],
  ["Return Received Email", "Subject + template for the manual “we've received your return” email", "Email"],
  ["Refund Processed Email", "Subject + template for the manual “your refund has been processed” email", "Email"],
  ["Wishlist Reminder", "WhatsApp template for the debounced wishlist follow-up", "WhatsApp"],
  ["WhatsApp — advanced", "Send-pacing interval (how far apart WhatsApp sends are spaced)", "WhatsApp"],
  ["GST Tax Invoice", "GSTIN, seller details, per-collection GST rates, invoice number prefix, PDF layout, and covering email — all in one section", "PDF + Email"],
];

export default function DocumentationPage() {
  return (
    <PageIn>
      <PageHeader
        title="Documentation"
        description="What every page and Settings section in this app actually does — which messages send automatically, which are manual, and where to edit the wording of anything a customer receives."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          ["9", "Pages in the app"],
          ["11", "Editable message templates"],
          ["2", "Channels — Email & WhatsApp"],
        ].map(([n, label]) => (
          <Card key={label} padding="16px 18px">
            <div style={{ fontSize: "22px", color: brand.ink }}>{n}</div>
            <div style={{ fontSize: "12px", color: brand.muted, marginTop: "2px" }}>{label}</div>
          </Card>
        ))}
      </div>

      <GroupCard icon="grid" title="Home" navPath="Sidebar → Home">
        <PageEntry
          title="Overview"
          route="/app/overview"
          purpose="The landing dashboard — a snapshot of what needs attention right now."
          points={[
            "Surfaces the same “needs attention” signal that drives the sidebar's health dot and badge counts, so nothing important is buried inside a page you haven't opened yet.",
            "One place to see, at a glance, whether Gmail, Google Sheets, Interakt (WhatsApp), and Google Places are all connected before relying on any of them.",
          ]}
        />
      </GroupCard>

      <GroupCard icon="tag" title="Catalog" navPath="Sidebar → Catalog">
        <PageEntry
          title="Jewelry Pricing"
          route="/app"
          purpose="Controls the metal, making-charge, and tax rates behind every “Gemstone Customisation” price on the storefront."
          points={[
            "Set current rates for Silver, Panchdhatu, and Copper settings, the making/labour charge, and whether GST applies on top of the making charge.",
            "“Save Rates & Rebuild Customisation Matrix” regenerates the full priced variant set — every Type × Metal × Design combination, for both the default and pearl catalogs — as real, pre-built Shopify variants. Nothing is priced or created per-order.",
            "Reuses the exact same weight × metal-rate formula for catalog designs and customer-uploaded (“Customised”) designs, so a photo upload is never priced differently from a listed design.",
          ]}
          tags={["Core pricing engine", "Rebuild on demand only"]}
        />
      </GroupCard>

      <GroupCard icon="users" title="Leads" navPath="Sidebar → Leads">
        <PageEntry
          title="Astro Leads"
          route="/app/astro-leads"
          purpose="Everyone who's submitted their birth details on the storefront's Vedic astrology form, and what they were told."
          points={[
            "The storefront calculates the birth chart client-side (ascendant, moonsign, sunsign) and works out Life, Benefic, and Lucky stone recommendations before this app ever sees it.",
            "The lead is saved immediately, and the recommendation email + WhatsApp message fire right after, in the background — the customer's browser doesn't wait for either to actually finish sending.",
            "Each row shows the recommended stones, whether the email/WhatsApp went out, and a Send Now button to resend either regardless of what already happened.",
            "Every link a customer clicks from the email — “View My Full Recommendation,” each stone's “Buy Now” — is tracked, along with whether the email was opened at all.",
          ]}
          tags={["Sends immediately", "Email + WhatsApp", "Click & open tracking"]}
        />
        <PageEntry
          title="Wishlist Leads"
          route="/app/wishlist-leads"
          purpose="Everyone who's saved products to their wishlist, and where their reminder stands."
          points={[
            "Unlike Astro Leads, the reminder email + WhatsApp are not sent the moment someone adds an item — they go out on a debounced interval (configurable in Settings), so repeatedly adding items doesn't spam the same person.",
            "Shows which products are on each person's list and the reminder's send status, with its own manual resend.",
          ]}
          tags={["Debounced, not immediate", "Email + WhatsApp"]}
        />
      </GroupCard>

      <GroupCard icon="message" title="Messaging" navPath="Sidebar → Messaging">
        <PageEntry
          title="Messages & Orders"
          route="/app/whatsapp-events"
          purpose="A log of every WhatsApp message this app has sent tied to a real order, grouped by order."
          points={["Useful for confirming a specific customer actually received their Order Processing message, or for spotting a pattern of failures pointing at a misconfigured template."]}
        />
      </GroupCard>

      <GroupCard icon="package" title="Orders" navPath="Sidebar → Orders">
        <PageEntry
          title="GST Invoices"
          route="/app/invoices"
          purpose="Generate and email a GST-compliant tax invoice PDF for any order, on request."
          points={[
            "Pulls seller GSTIN, legal name, address, and per-collection GST rates from the GST Tax Invoice section of Settings — never from Shopify's own Settings → Taxes.",
            "Invoice numbering, the PDF layout, and the covering email are all independently editable templates.",
            "Never sends on its own — only when someone clicks Send Invoice here or from the order's page in Shopify Admin.",
          ]}
          tags={["Manual only", "PDF + Email"]}
        />
        <PageEntry
          title="Returns & Refunds"
          route="/app/returns-refunds"
          purpose="Send a Return Received or Refund Processed notification for any order, by hand, whenever you're ready."
          points={[
            "Every button here is manual — there's no tag, webhook, or timer that fires either notification on its own.",
            "Each order gets four independent buttons: Return Email, Return WhatsApp, Refund Email, and Refund WhatsApp. Sending one never touches another.",
            "The refund amount is a field you type in right there — it's not pulled from Shopify's own refund records, so double-check it before sending.",
            "Deliberately separate from Shopify's own automatic “Order refund” notification (Settings → Notifications, in Shopify Admin itself) — this app's messages are its own, sent independently.",
          ]}
          tags={["Manual only", "Email + WhatsApp", "Amount typed by staff"]}
        />
      </GroupCard>

      <GroupCard icon="server" title="System" navPath="Sidebar → System">
        <PageEntry
          title="System Health"
          route="/app/server-health"
          purpose="A live connectivity check for every external service this app depends on."
          points={["Confirms Gmail, Google Sheets, Interakt, and Google Places are each actually reachable with the credentials currently saved — not just that a field has something typed into it."]}
        />
        <PageEntry
          title="Settings"
          route="/app/settings"
          purpose="Where every credential, trigger, and message template in this app is configured — organized into independent sections, each with its own Save button."
          points={[
            "Saving one section — say, Refund Processed Email — only ever touches that section's own fields. It cannot blank out an unrelated setting like a GST rate, even if that field happened to be empty on your screen at the time.",
            "A field left blank always means “use the built-in default,” not “leave unchanged” — this is deliberate and consistent across the whole page (see the FAQ below). The one exception is genuine secrets (passwords, API keys), which show “•••• already set” and are never cleared by leaving them blank.",
            "Every editable email has a Preview button showing real sample data in the exact layout that will send, plus a one-click Reset to default.",
          ]}
        />

        <div style={{ margin: "16px 0 0", ...tableWrapStyle }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Section</th>
                <th style={thStyle}>Controls</th>
                <th style={thStyle}>Channel</th>
              </tr>
            </thead>
            <tbody>
              {SETTINGS_ROWS.map(([name, desc, channel]) => (
                <tr key={name}>
                  <td style={{ ...tdStyle, fontWeight: 500, color: brand.ink, whiteSpace: "nowrap" }}>{name}</td>
                  <td style={tdStyle}>{desc}</td>
                  <td style={{ ...tdStyle, fontFamily: brand.mono, fontSize: "12px", color: brand.accent, whiteSpace: "nowrap" }}>{channel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ ...hintStyle, marginTop: "12px" }}>
          <strong style={{ color: brand.ink }}>Why a WhatsApp send can fail even with the right template name:</strong> Interakt also checks the
          template's exact approval status and language, and — if the template has a button with a dynamic link — needs a real destination URL for
          it. See the FAQ below for the exact error messages each of these produces.
        </p>
      </GroupCard>

      <Card style={{ marginTop: "6px" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "18px", color: brand.ink, display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon name="help-circle" size={18} color={brand.accent} />
          Frequently asked
        </h2>

        <FaqItem q="Why didn't a WhatsApp message send at all?">
          Almost always one of: the Interakt API key isn't set, the template name in Settings doesn't <em>exactly</em> match what's approved in
          Interakt (case and underscores included), the template's status in Interakt isn't "Approved" yet, or its language doesn't match. The
          error message returned always names which of these it is — e.g.{" "}
          <code style={{ fontFamily: brand.mono, background: brand.panel, padding: "1px 5px", borderRadius: "4px" }}>
            No approved template found with name 'x' and language 'en'
          </code>{" "}
          means a name, status, or language mismatch specifically.
        </FaqItem>

        <FaqItem q="A WhatsApp send fails with &quot;Missing variable values for template's button&quot; — what does that mean?">
          The approved template has a clickable button (like "View Order") built with a dynamic link, and WhatsApp numbers that button's variable
          completely separately from the message body's own <code style={{ fontFamily: brand.mono }}>{"{{1}}"}</code>/
          <code style={{ fontFamily: brand.mono }}>{"{{2}}"}</code>. If you add or change a template's button in Interakt, mention it here so the
          send can be updated to supply that button's value too.
        </FaqItem>

        <FaqItem q="I saved one setting and an unrelated one disappeared — will that happen again?">
          No. Every section on the Settings page saves independently — clicking Save under, say, "Refund Processed Email" only ever submits that
          section's own fields. It's structurally impossible for it to touch a GST rate or any other section's value, even if that field happened
          to be blank on your screen.
        </FaqItem>

        <FaqItem q="What does leaving a field blank actually do?">
          Blank means <strong style={{ color: brand.ink }}>"use the built-in default,"</strong> not "leave whatever was there before." This is the
          same rule everywhere on the Settings page — clearing a template box and saving resets that message to its original design, on purpose.
          The two exceptions are genuine secrets (API keys, app passwords), which show "•••• already set" and are never cleared by an empty field.
        </FaqItem>

        <FaqItem q="Does the Gem Recommendation message send the instant someone submits the form?">
          Yes — both the email and WhatsApp are kicked off right after the lead is saved, in the background, with no delay or batching. The
          customer's browser gets its result back without waiting for either to finish, which is why a slow Gmail connection never makes the
          astrology results page feel slow.
        </FaqItem>

        <FaqItem q="Is the Wishlist reminder the same — instant?">
          No — that one is deliberately debounced on an interval you set in Settings (WhatsApp — advanced), so someone adding several items in one
          session gets one reminder later, not one per item.
        </FaqItem>

        <FaqItem q="How is Returns & Refunds different from Shopify's own &quot;Order refund&quot; email?">
          Shopify already sends its own native refund email automatically whenever a refund is processed from Admin (unless you uncheck "Send a
          notification" at that moment). This app's Return Received and Refund Processed messages are separate and entirely manual — they exist so
          you can send your own branded version, on your own timing, independent of whatever Shopify does natively for the same order.
        </FaqItem>

        <FaqItem q="Can I change the wording of any of these messages?">
          Every email has a full HTML template + subject line you can edit on the Settings page, with a live Preview and a one-click reset if you
          want the original back. WhatsApp templates are edited in Interakt itself (Shopify/WhatsApp require every business-initiated message to
          use a pre-approved template) — this app only lets you choose <em>which</em> approved template name to use, and send a test.
        </FaqItem>

        <FaqItem q="Where does the Gemstone Customisation pricing actually get changed?">
          Jewelry Pricing (the app's home page) is the only place — set the metal/making-charge/tax rates there and click "Save Rates & Rebuild
          Customisation Matrix." The underlying pricing logic itself is considered stable and isn't meant to be changed casually.
        </FaqItem>
      </Card>
    </PageIn>
  );
}
