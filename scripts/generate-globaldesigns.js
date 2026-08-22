const fs = require("fs");
const data = require(process.argv[2]);

function entryLine(e, indent) {
  const parts = [`design: ${JSON.stringify(e.design)}`, `weight: ${e.weight}`];
  if (e.price !== undefined) parts.push(`price: ${e.price}`);
  parts.push(`image: ${JSON.stringify(e.image)}`);
  return `${indent}{ ${parts.join(", ")} },`;
}

function metalBlock(metals, indent) {
  const order = ["silver", "copper", "22k-yellow", "18k-yellow", "18k-white", "14k-yellow", "14k-white", "panchdhatu"];
  const keys = Object.keys(metals).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys
    .map((k) => {
      const lines = metals[k].map((e) => entryLine(e, indent + "  "));
      return `${indent}${/^[a-zA-Z0-9_$]+$/.test(k) ? k : JSON.stringify(k)}: [\n${lines.join("\n")}\n${indent}],`;
    })
    .join("\n");
}

function typeBlock(types, indent) {
  const order = ["ring", "pendant", "bracelet"];
  const keys = Object.keys(types).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys
    .map((k) => `${indent}${k}: {\n${metalBlock(types[k], indent + "  ")}\n${indent}},`)
    .join("\n");
}

const out = `/**
 * Server-side copy of the global fallback design catalog defined in the
 * theme's snippets/shubh-gems-global-designs.liquid — the catalog used
 * when a gemstone product has no product-specific ring_designs/
 * pandent_designs/bracelet_designs metaobject entries for the selected
 * metal.
 *
 * GENERATED, NOT HAND-WRITTEN: this file is produced by parsing the
 * theme snippet's own {% capture json_str %}...{% endcapture %} blocks
 * as real JSON (see scripts/extract-designs.js in the app repo, or ask
 * for it if it's not there) — not manually transcribed. This matters:
 * the previous hand-ported copy of this file had drifted significantly
 * from the live theme (different weights, missing price fields, wrong
 * image domain) after enough manual edits on each side, which meant
 * every product repriced through this app was charging the WRONG price
 * relative to what the storefront customizer displayed while a customer
 * was choosing a design — sometimes by ~20x. Re-generate this file from
 * a fresh theme pull any time snippets/shubh-gems-global-designs.liquid
 * changes, rather than hand-editing this one to match — the whole point
 * of generating it is to remove hand-editing as a source of drift.
 *
 * Regenerated: ${new Date().toISOString().slice(0, 10)}, from the live theme (#189200892203, "Dawn").
 */

// Metal key detection mirrors the theme JS's getRateForMetal() substring
// matching exactly, so a given metal title always resolves to the same
// bucket here as it does client-side.
export function metalKeyFor(metalTitle) {
  const t = (metalTitle || "").toLowerCase();
  if (t.includes("silver") || t.includes("chandi")) return "silver";
  if (t.includes("panchdhatu")) return "panchdhatu";
  if (t.includes("copper") || t.includes("tamba")) return "copper";
  if (t.includes("22k") && t.includes("yellow")) return "22k-yellow";
  if (t.includes("18k") && t.includes("yellow")) return "18k-yellow";
  if (t.includes("18k") && t.includes("white")) return "18k-white";
  if (t.includes("14k") && t.includes("yellow")) return "14k-yellow";
  if (t.includes("14k") && t.includes("white")) return "14k-white";
  return null;
}

export const GLOBAL_DESIGNS = {
  pearl: {
${typeBlock(data.pearl, "    ")}
  },
  default: {
${typeBlock(data.default, "    ")}
  },
};

// Used by pricing.server.js's computeTrustedQuote() — the App Proxy's
// server-side price recomputation that never trusts a client-sent total.
// Looks up one design's catalog entry by type/metal/design code, falling
// back to null (caller throws QuoteError) when nothing matches.
export function lookupGlobalDesign({ type, metalTitle, designCode, designSet }) {
  const setKey = designSet === "pearl" ? "pearl" : "default";
  const typeKey = (type || "").includes("ring")
    ? "ring"
    : (type || "").includes("pend") || (type || "").includes("pand")
      ? "pendant"
      : (type || "").includes("bracelet")
        ? "bracelet"
        : null;
  const metalKey = metalKeyFor(metalTitle);
  if (!typeKey || !metalKey) return null;
  const list = GLOBAL_DESIGNS[setKey]?.[typeKey]?.[metalKey];
  if (!list) return null;
  return list.find((d) => d.design === designCode) || null;
}
`;

fs.writeFileSync(process.argv[3], out, "utf-8");
console.log("Wrote", process.argv[3], out.length, "chars");
