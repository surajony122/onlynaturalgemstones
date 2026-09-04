/**
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
 * Regenerated: 2026-09-04, from the current TEST theme (#190744330539, "TEST - DO NOT PUBLISH").
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
    ring: {
      silver: [
        { design: "RD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-silver.jpg" },
        { design: "RD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-silver.jpg" },
        { design: "RD03", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-silver.jpg" },
        { design: "RD04", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-silver.jpg" },
        { design: "RD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-silver.jpg" },
        { design: "RD06", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-silver.jpg" },
        { design: "RD07", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "22k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-white": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-silver.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-silver.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-silver.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-silver.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-silver.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-silver.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-white": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-silver.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-silver.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-silver.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-silver.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-silver.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-silver.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
    },
    pendant: {
      silver: [
        { design: "PD11", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-silver.jpg" },
        { design: "PD12", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-silver.jpg" },
        { design: "PD13", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-silver.jpg" },
        { design: "PD14", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-silver.jpg" },
        { design: "PD15", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-silver.jpg" },
        { design: "PD16", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-silver.jpg" },
        { design: "PD17", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-silver.jpg" },
        { design: "Customised", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "22k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-white": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-silver.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-silver.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-silver.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-silver.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-silver.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-silver.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-white": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-silver.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-silver.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-silver.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-silver.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-silver.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-silver.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
    },
  },
  default: {
    ring: {
      silver: [
        { design: "RD11", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg" },
        { design: "RD21", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg" },
        { design: "RD23", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg" },
        { design: "RD24", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg" },
        { design: "RD25", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg" },
        { design: "RD26", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg" },
        { design: "RD27", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg" },
        { design: "RD30", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg" },
        { design: "RD31", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg" },
        { design: "RD32", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg" },
        { design: "RD34", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg" },
        { design: "RD36", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg" },
        { design: "RD37", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg" },
        { design: "RD39", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg" },
        { design: "RD40", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      copper: [
        { design: "RD25", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Copper.jpg" },
        { design: "RD40", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Copper.jpg" },
        { design: "Customised", weight: undefined, price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "22k-yellow": [
        { design: "RD11", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg" },
        { design: "RD21", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg" },
        { design: "RD23", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg" },
        { design: "RD24", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg" },
        { design: "RD25", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg" },
        { design: "RD26", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg" },
        { design: "RD27", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg" },
        { design: "RD30", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg" },
        { design: "RD31", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg" },
        { design: "RD32", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg" },
        { design: "RD34", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg" },
        { design: "RD36", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg" },
        { design: "RD37", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg" },
        { design: "RD39", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg" },
        { design: "RD40", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-yellow": [
        { design: "RD11", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg" },
        { design: "RD21", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg" },
        { design: "RD23", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg" },
        { design: "RD24", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg" },
        { design: "RD25", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg" },
        { design: "RD26", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg" },
        { design: "RD27", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg" },
        { design: "RD30", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg" },
        { design: "RD31", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg" },
        { design: "RD32", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg" },
        { design: "RD34", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg" },
        { design: "RD36", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg" },
        { design: "RD37", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg" },
        { design: "RD39", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg" },
        { design: "RD40", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-white": [
        { design: "RD11", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg" },
        { design: "RD21", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg" },
        { design: "RD23", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg" },
        { design: "RD24", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg" },
        { design: "RD25", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg" },
        { design: "RD26", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg" },
        { design: "RD27", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg" },
        { design: "RD30", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg" },
        { design: "RD31", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg" },
        { design: "RD32", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg" },
        { design: "RD34", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg" },
        { design: "RD36", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg" },
        { design: "RD37", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg" },
        { design: "RD39", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg" },
        { design: "RD40", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-yellow": [
        { design: "RD11", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg" },
        { design: "RD21", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg" },
        { design: "RD23", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg" },
        { design: "RD24", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg" },
        { design: "RD25", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg" },
        { design: "RD26", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg" },
        { design: "RD27", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg" },
        { design: "RD30", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg" },
        { design: "RD31", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg" },
        { design: "RD32", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg" },
        { design: "RD34", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg" },
        { design: "RD36", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg" },
        { design: "RD37", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg" },
        { design: "RD39", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg" },
        { design: "RD40", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-white": [
        { design: "RD11", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg" },
        { design: "RD21", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg" },
        { design: "RD23", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg" },
        { design: "RD24", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg" },
        { design: "RD25", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg" },
        { design: "RD26", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg" },
        { design: "RD27", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg" },
        { design: "RD30", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg" },
        { design: "RD31", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg" },
        { design: "RD32", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg" },
        { design: "RD34", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg" },
        { design: "RD36", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg" },
        { design: "RD37", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg" },
        { design: "RD39", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg" },
        { design: "RD40", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      panchdhatu: [
        { design: "RD11", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg" },
        { design: "RD21", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg" },
        { design: "RD23", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg" },
        { design: "RD24", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg" },
        { design: "RD25", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg" },
        { design: "RD26", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg" },
        { design: "RD27", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg" },
        { design: "RD30", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg" },
        { design: "RD31", weight: undefined, price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg" },
        { design: "RD32", weight: undefined, price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg" },
        { design: "RD34", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg" },
        { design: "RD36", weight: undefined, price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg" },
        { design: "RD37", weight: undefined, price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg" },
        { design: "RD39", weight: undefined, price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg" },
        { design: "RD40", weight: undefined, price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg" },
        { design: "Customised", weight: undefined, price: 3000, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
    },
    pendant: {
      silver: [
        { design: "PD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg" },
        { design: "PD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg" },
        { design: "PD03", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg" },
        { design: "PD04", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg" },
        { design: "PD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg" },
        { design: "Customised", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      copper: [
        { design: "PD02", weight: 2, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-copper.jpg" },
        { design: "PD03", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg" },
        { design: "PD06", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg" },
        { design: "Customised", weight: undefined, price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "22k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "18k-white": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      "14k-white": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg" },
        { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      panchdhatu: [
        { design: "PD01", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: undefined, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: undefined, price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        { design: "Customised", weight: undefined, price: 2000, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
    },
    bracelet: {
      silver: [
        { design: "BR01", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br01.jpg" },
        { design: "BR02", weight: 30, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br02.jpg" },
        { design: "BR08", weight: 20, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br08.jpg" },
      ],
    },
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
