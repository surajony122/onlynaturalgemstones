/**
 * In-app guide to ONG Controls, in five tabs: Start here, Pages, Settings,
 * Automations and FAQ. Static content (no loader/action), built from the same
 * Card / PageHeader / Icon / brand pieces every other page uses, so it reads
 * as part of the app. Keep it in step with the sidebar (NAV_GROUPS in
 * components/app-shell.jsx) and the Settings tabs (SETTINGS_TABS in
 * routes/app.settings.jsx) when pages or sections change.
 */
import { useState } from "react";
import { Link } from "react-router";
import { brand, Icon, Card, PageHeader, PageIn, tableWrapStyle, tableStyle, thStyle, tdStyle, Pill } from "../components/table-kit";

const hintStyle = { fontSize: "13px", color: brand.body, lineHeight: 1.6, margin: "0 0 10px" };
const codeStyle = { fontFamily: brand.mono, background: brand.panel, padding: "1px 5px", borderRadius: "4px", fontSize: "12px" };

const TABS = [
  { id: "start", label: "Start here", icon: "home" },
  { id: "pages", label: "Pages", icon: "grid" },
  { id: "settings", label: "Settings", icon: "gear" },
  { id: "automations", label: "Automations", icon: "zap" },
  { id: "faq", label: "FAQ", icon: "help-circle" },
];

function DocTabs({ tab, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Documentation sections"
      style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px", borderBottom: `1px solid ${brand.border}` }}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "10px 14px",
              marginBottom: "-1px",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${active ? brand.accent : "transparent"}`,
              color: active ? brand.ink : brand.muted,
              fontSize: "13.5px",
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            <Icon name={t.icon} size={15} color={active ? brand.accent : "currentColor"} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function IconTile({ name, color = brand.accent, bg = brand.accentTint }) {
  return (
    <span style={{ width: "32px", height: "32px", borderRadius: "9px", background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name={name} size={16} color={color} />
    </span>
  );
}

// A titled block with an icon, used for every section of every tab.
function Block({ icon, title, hint, children, color, bg }) {
  return (
    <Card style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "11px", marginBottom: hint ? "4px" : "12px" }}>
        <IconTile name={icon} color={color} bg={bg} />
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: brand.ink }}>{title}</h2>
      </div>
      {hint && <p style={{ margin: "0 0 12px 43px", fontSize: "12.5px", color: brand.muted }}>{hint}</p>}
      {children}
    </Card>
  );
}

// One collapsible group of pages, matching the sidebar's own grouping.
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
          padding: "15px 20px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "11px", fontSize: "15px", fontWeight: 600, color: brand.ink, minWidth: 0 }}>
          <IconTile name={icon} />
          {title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "11.5px", color: brand.faint, fontFamily: brand.mono }}>{navPath}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={brand.muted} style={{ flexShrink: 0 }} />
        </span>
      </button>
      {open && <div style={{ padding: "0 20px 14px" }}>{children}</div>}
    </Card>
  );
}

// One page's entry inside a GroupCard: name, link, one-line purpose, bullets.
function PageEntry({ icon, title, route, purpose, points, tags }) {
  return (
    <div style={{ padding: "14px 0", borderTop: `1px solid ${brand.divider}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
        {icon && <Icon name={icon} size={15} color={brand.muted} />}
        <span style={{ fontSize: "14px", fontWeight: 600, color: brand.ink }}>{title}</span>
        <Link to={route} style={{ ...codeStyle, color: brand.accent, background: brand.accentTint, textDecoration: "none" }}>
          {route}
        </Link>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: "13px", color: brand.muted }}>{purpose}</p>
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

function FaqItem({ q, children }) {
  return (
    <details style={{ padding: "14px 0", borderTop: `1px solid ${brand.divider}` }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "14px", color: brand.ink, listStyle: "none" }}>
        <Icon name="help-circle" size={15} color={brand.accent} style={{ flexShrink: 0, marginTop: "2px" }} />
        {q}
      </summary>
      <div style={{ marginTop: "8px", marginLeft: "23px", fontSize: "13.5px", color: brand.body, lineHeight: 1.65, maxWidth: "66ch" }}>{children}</div>
    </details>
  );
}

function DocTable({ head, rows, firstCellStrong = true }) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ ...tdStyle, ...(j === 0 && firstCellStrong ? { fontWeight: 600, color: brand.ink, whiteSpace: "nowrap" } : {}) }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ tab: Start here

const FIRST_STEPS = [
  ["plug", "Connect your accounts", "Settings → Connections: add the Gmail address and app password (every email sends through it) and the Interakt key (every WhatsApp message). Google Sheets and Google Places are optional extras."],
  ["whatsapp", "Choose your WhatsApp templates", "Settings → WhatsApp messages: type the exact name of each template that is approved in Interakt. The wording itself is edited in Interakt."],
  ["mail", "Check the email wording and send yourself a test", "Settings → Emails: review the two email templates, then use “Send a test email” to receive a real sample at your own address. Nothing goes to customers."],
  ["receipt", "Fill in your invoice details", "Settings → Invoices: GSTIN, seller details, GST rates per collection, invoice number prefix and the PDF layout."],
  ["rupee", "Set today's metal rates", "Jewelry Pricing: enter the rates and press “Save Rates & Rebuild Customisation Matrix”. Customisation prices on the storefront follow these rates."],
  ["check-circle", "Confirm everything is healthy", "Open Overview. “All clear” means no failed messages, leads or invoices in the last 7 days. System Health runs a live check of every connection."],
];

const SIDEBAR_GROUPS = [
  ["home", "Home", "Overview", "The page the app opens on: what needs attention, today's numbers, and a panel for every part of the app."],
  ["diamond", "Store setup", "Jewelry Pricing · Gemstone details · Currency by country", "What customers see on the storefront: prices, stone details, currencies."],
  ["users", "Customers & leads", "Astro Leads · Wishlist Leads · Abandoned Checkouts", "Everyone who used the recommendation form, saved a wishlist or left a checkout, and what was sent to them."],
  ["package", "Orders & messages", "Messages & Orders · GST Invoices", "What happens after a purchase: WhatsApp messages and tax invoices."],
  ["gear", "System", "System Health · Settings · Documentation", "Connections, message templates, live checks and this guide."],
];

function StartTab() {
  return (
    <>
      <Block icon="sparkle" title="What this app does" hint="Four jobs, all connected to your Shopify store.">
        <ul style={{ margin: 0, paddingLeft: "18px" }}>
          {[
            "Prices the Gemstone Customisation add-on (rings, pendants, bracelets) from the metal rates you set.",
            "Follows every customer who used the gem recommendation form or saved a wishlist, and sends them WhatsApp and email messages.",
            "Sends order, refund, wishlist and abandoned-cart messages automatically, and creates GST tax invoices when you ask.",
            "Shows you, in one place, what worked, what failed and why.",
          ].map((t) => (
            <li key={t} style={{ fontSize: "13.5px", color: brand.body, lineHeight: 1.7, marginBottom: "3px" }}>
              {t}
            </li>
          ))}
        </ul>
      </Block>

      <Block icon="list" title="Your first 10 minutes" hint="Do these in order the first time. Each step says where to go.">
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {FIRST_STEPS.map(([icon, title, text], i) => (
            <li key={title} style={{ display: "flex", gap: "13px", padding: "12px 0", borderTop: i === 0 ? "none" : `1px solid ${brand.divider}` }}>
              <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: brand.accentTint, color: brand.accent, fontSize: "12.5px", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {i + 1}
              </span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "14px", fontWeight: 600, color: brand.ink, marginBottom: "2px" }}>
                  <Icon name={icon} size={14} color={brand.muted} />
                  {title}
                </div>
                <div style={{ fontSize: "13px", color: brand.body, lineHeight: 1.6 }}>{text}</div>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <Block icon="sidebar" title="How the dashboard is laid out">
        <DocTable head={["Menu group", "Pages", "What it is for"]} rows={SIDEBAR_GROUPS.map(([icon, g, pages, why]) => [
          <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <Icon name={icon} size={15} color={brand.accent} />
            {g}
          </span>,
          pages,
          why,
        ])} />
        <p style={{ ...hintStyle, marginTop: "14px" }}>
          <strong style={{ color: brand.ink }}>The bar along the top of every page</strong> holds the page's own tools: the page name and a one-line
          description on the left; on the right, counts as small chips, the page's buttons (such as Export), an
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", height: "18px", borderRadius: "50%", border: `1px solid ${brand.border}`, fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: "11px", margin: "0 5px", color: brand.muted }}>i</span>
          button that opens a longer explanation, a red issue count when something needs attention, and Refresh.
        </p>
      </Block>
    </>
  );
}

// ------------------------------------------------------------------ tab: Pages

function PagesTab() {
  return (
    <>
      <GroupCard icon="home" title="Home" navPath="Sidebar → Home">
        <PageEntry
          icon="grid"
          title="Overview"
          route="/app/overview"
          purpose="The page the app opens on. Everything important, on one screen."
          points={[
            "“Needs attention” lists failures from the last 7 days with the actual cause: which order or lead, which service failed (Interakt, Gmail, AstrologyAPI or Shopify), the error that service returned, and a link to where it is fixed.",
            "Six cards show today's numbers against yesterday's, with a 7-day bar chart for leads and WhatsApp sends.",
            "A panel for each area shows the latest few items and links into the full page: leads, wishlists, messages, invoices, pricing, gemstone details, currencies and connections.",
            "The Connections panel shows whether each service has been set up, not whether it is working right now. For a live check, open System Health.",
          ]}
        />
      </GroupCard>

      <GroupCard icon="diamond" title="Store setup" navPath="Sidebar → Store setup">
        <PageEntry
          icon="rupee"
          title="Jewelry Pricing"
          route="/app/pricing"
          purpose="Controls the metal, making-charge and tax rates behind every “Gemstone Customisation” price on the storefront."
          points={[
            "Set the rates for Silver, Panchdhatu, Copper and each gold type, plus the making charge and whether GST applies on top of it.",
            "“Save Rates & Rebuild Customisation Matrix” regenerates every priced option: each Type × Metal × Design, for both the standard and pearl catalogs.",
            "Customer-uploaded designs are priced by the same weight × metal-rate formula as catalog designs, so a photo upload is never priced differently.",
            "The health checks on this page confirm the matrix, sales channels and theme lookup are in step.",
          ]}
          tags={["Core pricing", "Rebuilds only when you press the button"]}
        />
        <PageEntry
          icon="diamond"
          title="Gemstone details"
          route="/app/gemstone-details"
          purpose="The per-stone facts shown on every gem recommendation: metal, finger, day, mantra, substitute stone and tagline."
          points={[
            "Add a stone, edit its details, or remove it (removed stones can be added back).",
            "Whatever you type replaces the automatic value. Leave a field blank to keep the automatic one, shown in grey.",
            "These details appear in the recommendation email, the WhatsApp message, the emailed result link and the storefront result page.",
            "The carat range is not set here. It is worked out from the customer's body weight: the top is weight ÷ 10 rounded up to the next ½ carat, the bottom is weight ÷ 12 rounded down to the nearest ½ carat. Diamonds use finer steps.",
          ]}
          tags={["Edits what customers read", "Blank = automatic value"]}
        />
        <PageEntry
          icon="globe"
          title="Currency by country"
          route="/app/currency-countries"
          purpose="Chooses which countries the storefront's currency selector offers, and the currency each one shows."
          points={[
            "Countries are grouped by continent. Turn each on or off and pick its currency.",
            "Save keeps your choices in the app. “Save & publish” writes them into the theme you pick, so the storefront can read them. Try a test theme first, then the live one.",
            "Prices are converted from INR for display only. Checkout is always charged in INR.",
            "The “Is the website up to date?” card shows whether each theme matches what you saved.",
          ]}
          tags={["Display only", "Publish to a theme"]}
        />
      </GroupCard>

      <GroupCard icon="users" title="Customers & leads" navPath="Sidebar → Customers & leads">
        <PageEntry
          icon="users"
          title="Astro Leads"
          route="/app/astro-leads"
          purpose="Everyone who submitted their birth details on the gem recommendation form, and what they were told."
          points={[
            "The customer first confirms a one-time code (sent by WhatsApp and/or email). Once confirmed, the lead is saved and the result is sent. If neither code can be delivered, the lead is still saved so your team can follow up.",
            "The recommendation email and WhatsApp message go out right after the lead is saved, in the background, so the customer's results page never waits for them.",
            "Each row shows the recommended stones, whether the email and WhatsApp went out, and a menu to send again.",
            "Links in the email are tracked: whether it was opened (approximate) and which link was clicked (exact).",
          ]}
          tags={["Sends immediately", "Email + WhatsApp", "Export to CSV"]}
        />
        <PageEntry
          icon="heart"
          title="Wishlist Leads"
          route="/app/wishlist-leads"
          purpose="Everyone who has saved products to a wishlist, and where their reminder stands."
          points={[
            "Reminders are not sent the moment someone adds an item. They go out once the customer has been quiet for the interval set in Settings → Emails (default 2 hours).",
            "The header shows a countdown to the next check, which runs every minute.",
            "Each row shows the saved products and the reminder's status, with its own menu for Send now, Retry WhatsApp and Delete.",
          ]}
          tags={["Debounced, not instant", "Email + WhatsApp", "Export to CSV"]}
        />
      </GroupCard>

      <GroupCard icon="cart" title="Abandoned checkouts" navPath="Sidebar → Customers & leads">
        <PageEntry
          icon="cart"
          title="Abandoned Checkouts"
          route="/app/abandoned-checkouts"
          purpose="Every abandoned checkout, read live from Shopify, with what the reminder email did about it."
          points={[
            "Each row shows the checkout, the customer and whether they agreed to email marketing, the cart, the total, and the email's status: sent, failed, waiting, not emailed (with the reason) or recovered.",
            "Filter by status, search by name, email or item, and look back 3, 7, 14 or 30 days.",
            "Send now sends one email immediately (it skips the wait but still honours consent, unsubscribes and earlier orders). Retry resends a failed one. Don't email stops that checkout from ever being emailed.",
            "Send due emails now runs the check straight away instead of waiting for the next 5-minute pass.",
            "While the emails are switched off, the list shows what would happen to each checkout.",
          ]}
          tags={["Read live from Shopify", "Send / Retry / Skip"]}
        />
      </GroupCard>

      <GroupCard icon="package" title="Orders & messages" navPath="Sidebar → Orders & messages">
        <PageEntry
          icon="whatsapp"
          title="Messages & Orders"
          route="/app/whatsapp-events"
          purpose="A log of every WhatsApp message the app sent, grouped by order where it belongs to one."
          points={[
            "Use it to confirm a customer actually received their order message, or to spot a pattern of failures pointing at a setup problem.",
            "Delivered and read statuses come from Interakt's webhook, so nothing shows until the webhook is set up (Settings → Connections → WhatsApp — advanced).",
            "A row's “…” menu can retry the message or delete its log entry.",
          ]}
        />
        <PageEntry
          icon="receipt"
          title="GST Invoices"
          route="/app/invoices"
          purpose="Generate and email a GST tax invoice PDF for any order, on request."
          points={[
            "Seller GSTIN, name, address and per-collection GST rates come from Settings → Invoices, never from Shopify's own tax settings.",
            "Invoice numbering, the PDF layout and the covering email are all editable templates.",
            "Never sends on its own. It sends only when someone clicks Send here, or on the order's page in Shopify admin.",
          ]}
          tags={["Manual only", "PDF + Email"]}
        />
      </GroupCard>

      <GroupCard icon="gear" title="System" navPath="Sidebar → System">
        <PageEntry
          icon="server"
          title="System Health"
          route="/app/server-health"
          purpose="A live connectivity check for every service the app depends on."
          points={["Confirms Gmail, Google Sheets, Interakt and Google Places are each reachable with the credentials currently saved, not just that a field has something in it."]}
        />
        <PageEntry
          icon="gear"
          title="Settings"
          route="/app/settings"
          purpose="Every connection, trigger and message template, in four tabs."
          points={[
            "Each section has its own Save button and saves only its own fields, so changing one setting can never overwrite another.",
            "Service status (Gmail, WhatsApp, Google Sheets, Google Places) shows as chips in the top bar. Hover one to see why.",
            "The Settings tab has its own guide, in the next tab of this page.",
          ]}
        />
        <PageEntry icon="file-text" title="Documentation" route="/app/documentation" purpose="This guide." points={["Five tabs: Start here, Pages, Settings, Automations and FAQ."]} />
      </GroupCard>
    </>
  );
}

// ------------------------------------------------------------------ tab: Settings

const SETTINGS_TAB_DOCS = [
  {
    icon: "plug",
    title: "Connections",
    hint: "One-time technical setup. Nothing here is sent to customers.",
    rows: [
      ["WhatsApp (Interakt)", "The Interakt key that every WhatsApp message sends through.", "WhatsApp"],
      ["Email sending (Gmail)", "The Gmail address and app password used for every email.", "Email"],
      ["Google Sheets mirror (optional)", "A service account and spreadsheet that keep a backup copy of your leads.", "—"],
      ["Location Autocomplete (Google Places)", "The key behind the “Place of Birth” suggestions on the recommendation form.", "—"],
      ["WhatsApp — advanced", "How far apart WhatsApp sends are spaced, and the secret for Interakt's delivery and read webhook.", "WhatsApp"],
    ],
  },
  {
    icon: "whatsapp",
    title: "WhatsApp messages",
    hint: "Choose which approved Interakt template each message uses. The wording is edited in Interakt.",
    rows: [
      ["Gem Recommendation", "Template name for the recommendation result message, with a test send.", "WhatsApp"],
      ["Order Processing", "The order tag that triggers “your order is being prepared”, and the template name.", "WhatsApp"],
      ["Refund WhatsApp", "Template name for the automatic “your refund has been processed” message, with a test send.", "WhatsApp"],
      ["Wishlist Reminder", "Template name for the wishlist follow-up.", "WhatsApp"],
    ],
  },
  {
    icon: "mail",
    title: "Emails",
    hint: "Every email has an editable subject and full layout, with a live preview and a one-click reset.",
    rows: [
      ["Wishlist email timing", "How long to wait after a customer's last wishlist change before the reminder goes out.", "Email + WhatsApp"],
      ["Send a test email", "Sends a real sample (wishlist, order processing or astro advice) to an address you type.", "Email"],
      ["Gem Recommendation — Email", "Subject and layout of the recommendation email.", "Email"],
      ["Order Processing — Email", "Subject and layout of the “order being prepared” email.", "Email"],
      ["Abandoned Checkout — Email", "Switch cart reminders on or off, choose how long a checkout must be idle, edit the subject and layout, preview it, and see who would get an email right now.", "Email"],
    ],
  },
  {
    icon: "receipt",
    title: "Invoices",
    hint: "Everything about the GST tax invoice, in one section.",
    rows: [
      ["GST Tax Invoice", "GSTIN, seller details, GST rates per collection, invoice number prefix, the PDF layout and the covering email.", "PDF + Email"],
    ],
  },
];

function SettingsTab() {
  return (
    <>
      <p style={{ ...hintStyle, marginBottom: "16px" }}>
        The Settings page has four tabs. This is what each section lets you do.
      </p>
      {SETTINGS_TAB_DOCS.map((t) => (
        <Block key={t.title} icon={t.icon} title={t.title} hint={t.hint}>
          <DocTable head={["Section", "What you can do", "Channel"]} rows={t.rows.map(([a, b, c]) => [a, b, <span key={c} style={{ fontFamily: brand.mono, fontSize: "12px", color: brand.accent, whiteSpace: "nowrap" }}>{c}</span>])} />
        </Block>
      ))}

      <Block icon="info" title="Three rules that apply to the whole page">
        <ul style={{ margin: 0, paddingLeft: "18px" }}>
          {[
            <>
              <strong style={{ color: brand.ink }}>Each section saves on its own.</strong> Saving Refund WhatsApp touches only that section's fields, never a GST rate or anything else.
            </>,
            <>
              <strong style={{ color: brand.ink }}>A blank field means “use the built-in default”</strong>, not “leave unchanged”. Clearing a template box and saving resets it to the original design. The exception is secrets (API keys, app passwords): they show “•••• already set” and an empty field never clears them.
            </>,
            <>
              <strong style={{ color: brand.ink }}>Switching tabs never loses what you have typed.</strong> The tabs only hide the other sections. Press a section's Save button to keep your changes.
            </>,
          ].map((t, i) => (
            <li key={i} style={{ fontSize: "13px", color: brand.body, lineHeight: 1.7, marginBottom: "5px" }}>
              {t}
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

// ------------------------------------------------------------------ tab: Automations

const AUTOMATIONS = [
  ["Gem recommendation result", "WhatsApp + email", "Right after the customer confirms their one-time code and the lead is saved.", "Email: Settings → Emails. WhatsApp: template name in Settings → WhatsApp messages; wording in Interakt.", "Astro Leads"],
  ["Wishlist reminder", "WhatsApp + email", "After a customer has been quiet for the set interval (default 2 hours).", "Interval: Settings → Emails. WhatsApp template: Settings → WhatsApp messages.", "Wishlist Leads"],
  ["Order is being prepared", "WhatsApp + email", "When an order gets the trigger tag set in Settings → WhatsApp messages. A catch-up check also runs on a schedule, so a missed order is picked up.", "Email: Settings → Emails. WhatsApp: Settings → WhatsApp messages.", "Messages & Orders"],
  ["Refund processed", "WhatsApp", "Automatically when a refund is processed in Shopify. Refunds that come from cancelling an order are skipped.", "Template name: Settings → WhatsApp messages.", "Messages & Orders"],
  ["Abandoned checkout reminder", "Email", "Once per checkout, after it has been idle for the wait time you set (default 1 hour). Only for customers who agreed to email marketing, who have not ordered since, have not unsubscribed, and were not already emailed in the last 24 hours. Switched OFF until you turn it on, and then only for checkouts started after that moment.", "Settings → Emails (switch, wait time, subject, layout, test email).", "Settings → Emails (Latest checkouts handled)"],
  ["GST tax invoice", "Email with PDF", "Only when someone clicks Send. Never automatic.", "Settings → Invoices.", "GST Invoices"],
];

const STATUS_MEANINGS = [
  ["Sent", "The app handed the message to Gmail or Interakt without an error."],
  ["Opened", "Approximate. Some mail apps block tracking images, so a real open may not be counted."],
  ["Clicked", "Exact. Hover it to see which link was clicked."],
  ["Delivered / Read", "Reported by Interakt's webhook, so it only appears once the webhook is set up (Settings → Connections → WhatsApp — advanced)."],
  ["Failed", "The service returned an error. The Overview's “Needs attention” panel shows the reason and where to fix it."],
  ["Skipped", "Nothing was sent on purpose, for example the customer has no phone number."],
];

function AutomationsTab() {
  return (
    <>
      <Block icon="zap" title="What sends automatically" hint="Everything else on this list is manual.">
        <DocTable head={["Message", "Channel", "When it sends", "Where you change it", "See it in"]} rows={AUTOMATIONS} />
        <p style={{ ...hintStyle, marginTop: "12px" }}>
          WhatsApp requires every business-started message to use a template that Meta has approved. This app lets you pick which approved
          template to use and send a test. The wording itself is edited in Interakt.
        </p>
      </Block>

      <Block icon="check-circle" title="What the statuses mean">
        <DocTable head={["Status", "Meaning"]} rows={STATUS_MEANINGS} />
      </Block>

      <Block icon="user" title="Customer account pages" hint="Two pages inside Shopify's own “My account”, added by this app.">
        <ul style={{ margin: 0, paddingLeft: "18px" }}>
          {[
            <>
              <strong style={{ color: brand.ink }}>My Wishlist.</strong> Shows the products saved on the customer's account. It reads the customer's <code style={codeStyle}>wishlist:</code> tags in Shopify, and falls back to the app's own records.
            </>,
            <>
              <strong style={{ color: brand.ink }}>My Gemstone Recommendation.</strong> Shows their Life, Benefic and Lucky stones with photos, details and a Buy button. It reads the customer's <code style={codeStyle}>custom.astro_advice</code> metafield, and falls back to the app's own records.
            </>,
            <>A link to each page has to be added by hand in Shopify admin (Settings → Customer accounts → navigation). Shopify can't do that step from code.</>,
          ].map((t, i) => (
            <li key={i} style={{ fontSize: "13px", color: brand.body, lineHeight: 1.7, marginBottom: "5px" }}>
              {t}
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

// ------------------------------------------------------------------ tab: FAQ

function FaqTab() {
  return (
    <Card>
      <h2 style={{ margin: "0 0 4px", fontSize: "18px", color: brand.ink, display: "flex", alignItems: "center", gap: "8px" }}>
        <Icon name="help-circle" size={18} color={brand.accent} />
        Frequently asked
      </h2>

      <FaqItem q="What does “Needs attention” on the Overview mean?">
        It lists messages, leads or invoices that failed in the last 7 days. Each entry names the order or customer, the service that failed
        (WhatsApp via Interakt, email via Gmail, the birth-chart calculation, or Shopify), the exact error it returned, and a link to the place
        where it is usually fixed. Fix the cause, and the entry disappears once it is more than 7 days old or the item is sent again successfully.
      </FaqItem>

      <FaqItem q="Why didn't a WhatsApp message send at all?">
        Almost always one of: the Interakt key isn't set, the template name in Settings doesn't <em>exactly</em> match what is approved in Interakt
        (capitals and underscores included), the template isn't "Approved" yet, or its language doesn't match. The error always says which one,
        for example <code style={codeStyle}>No approved template found with name 'x' and language 'en'</code> means a name, status or language
        mismatch.
      </FaqItem>

      <FaqItem q="A WhatsApp send fails with &quot;Missing variable values for template's button&quot;. What does that mean?">
        The approved template has a clickable button (like "View Order") with a dynamic link, and WhatsApp numbers that button's variable
        separately from the message body's own <code style={codeStyle}>{"{{1}}"}</code>, <code style={codeStyle}>{"{{2}}"}</code>. If you add or
        change a template's button in Interakt, the app's send has to be updated to supply that button's value too.
      </FaqItem>

      <FaqItem q="Why does a connection say “Not set up” on the Overview, but System Health says it works?">
        The Overview only checks whether a value is saved. System Health makes a real call to the service. “Not set up” means nothing is saved
        yet. Add it under Settings → Connections.
      </FaqItem>

      <FaqItem q="I saved one setting and an unrelated one disappeared. Will that happen again?">
        No. Every section on the Settings page saves independently. Clicking Save under "Refund WhatsApp" only submits that section's fields, so
        it can't touch a GST rate or any other section.
      </FaqItem>

      <FaqItem q="What does leaving a field blank actually do?">
        Blank means <strong style={{ color: brand.ink }}>"use the built-in default,"</strong> not "leave what was there." Clearing a template box
        and saving resets that message to its original design, on purpose. Secrets (API keys, app passwords) are the exception: an empty field
        never clears them.
      </FaqItem>

      <FaqItem q="Does the Gem Recommendation message send the instant someone submits the form?">
        The customer first confirms a one-time code. Once that is verified, the lead is saved and both the email and WhatsApp message are started
        straight away in the background, so a slow Gmail connection never slows the customer's results page.
      </FaqItem>

      <FaqItem q="Is the Wishlist reminder instant too?">
        No. It is debounced on purpose: the interval is set in Settings → Emails, so someone adding several items in one visit gets one reminder
        later, not one per item.
      </FaqItem>

      <FaqItem q="How does the Refund WhatsApp message relate to Shopify's own refund email?">
        They are independent and both automatic. Shopify sends its own refund email when staff click Refund (unless "Send a notification" is
        unticked), and this app no longer sends refund emails of its own. Separately, the app listens for the same refund and sends one WhatsApp
        message. Refunds that come from cancelling an order are skipped.
      </FaqItem>

      <FaqItem q="Can I change the wording of these messages?">
        Every email has an editable subject and full layout under Settings → Emails, with a live preview and a one-click reset. WhatsApp wording is
        edited in Interakt itself, because WhatsApp requires pre-approved templates. This app only lets you choose which approved template to use,
        and send a test.
      </FaqItem>

      <FaqItem q="Where do I change Gemstone Customisation pricing?">
        Only on Jewelry Pricing. Set the rates and press “Save Rates & Rebuild Customisation Matrix”. The pricing logic itself is stable and isn't
        meant to be changed casually.
      </FaqItem>

      <FaqItem q="Why do some emails never arrive, even though they show as sent?">
        “Sent” means the app handed the email to Gmail without an error. A normal Gmail account limits how many emails it can send in a day
        (roughly a few hundred), so on a very busy day later emails may be refused. If failures appear on the Overview, check Gmail first.
      </FaqItem>

      <FaqItem q="Why didn't an abandoned checkout email go out?">
        The reminder is skipped, on purpose, when any of these is true: it is switched off in Settings → Emails; the checkout was started
        before you switched it on; the customer did not agree to email marketing; they placed an order after that checkout; they unsubscribed;
        they were already emailed in the last 24 hours; or the checkout has not been idle for the wait time yet. Open Settings → Emails →
        Abandoned Checkout and press <strong>Check now</strong>. It lists each recent checkout and the exact reason for its decision, and
        sends nothing. If an email failed to send, it appears under “Needs attention” on the Overview with the real error and a Retry button.
      </FaqItem>

      <FaqItem q="How does a customer unsubscribe from cart reminders?">
        Every abandoned checkout email has an “Unsubscribe from cart reminders” link (and the standard unsubscribe option in the mail app). One
        click stops further cart reminders to that address. It does not change their Shopify marketing subscription.
      </FaqItem>

      <FaqItem q="What is the “i” button at the top of a page?">
        It opens a longer explanation for that page, so the page itself stays clean. Click it again, click elsewhere, or press Escape to close it.
      </FaqItem>
    </Card>
  );
}

// ------------------------------------------------------------------ page

export default function DocumentationPage() {
  const [tab, setTab] = useState("start");
  return (
    <PageIn>
      <PageHeader
        title="Documentation"
        description="What every page, setting and automatic message in this app does."
        stats={[
          { label: "Pages", value: 12 },
          { label: "Settings sections", value: 14 },
          { label: "Automatic messages", value: 5 },
        ]}
      />

      <DocTabs tab={tab} onChange={setTab} />

      {tab === "start" && <StartTab />}
      {tab === "pages" && <PagesTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "automations" && <AutomationsTab />}
      {tab === "faq" && <FaqTab />}
    </PageIn>
  );
}
