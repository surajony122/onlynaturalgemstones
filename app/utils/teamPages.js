/**
 * The pages a team member can be given access to, and the ready-made presets.
 * Plain data (no server imports) so the menu, the Team access page and the
 * server-side checks all read the same list. The ids match the menu item ids
 * in app/components/app-shell.jsx.
 */
export const TEAM_PAGES = [
  { id: "overview", label: "Overview" },
  { id: "astro", label: "Astro Leads" },
  { id: "wishlist", label: "Wishlist Leads" },
  { id: "contact", label: "Contact Leads" },
  { id: "invoices", label: "GST Invoices" },
  { id: "pricing", label: "Jewelry Pricing" },
  { id: "gemdetails", label: "Gemstone details" },
  { id: "currency", label: "Currency by country" },
  { id: "designimages", label: "Design images" },
  { id: "whatsapp", label: "Logs" },
  { id: "team", label: "Team access" },
];

// Pages only an admin can open (they hold keys / system controls).
export const ADMIN_ONLY_PAGES = ["settings", "server"];
// Informational page every signed-in team member can read.
export const OPEN_PAGES = ["documentation"];

export const TEAM_PRESETS = {
  Sales: ["astro", "wishlist", "contact"],
  "Support / Orders": ["invoices", "whatsapp", "contact"],
  Accounts: ["invoices"],
  Catalogue: ["gemdetails", "designimages", "pricing"],
  Viewer: ["overview"],
};

export const ASSIGNABLE_IDS = TEAM_PAGES.map((p) => p.id);
