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
 * Regenerated: 2026-08-22, from the live theme (#189200892203, "Dawn").
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
        { design: "RD01", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-silver.jpg" },
        { design: "RD02", weight: 4.5, price: 1900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-silver.jpg" },
        { design: "RD03", weight: 4.5, price: 3000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-silver.jpg" },
        { design: "RD04", weight: 4.5, price: 1900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-silver.jpg" },
        { design: "RD05", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-silver.jpg" },
        { design: "RD06", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-silver.jpg" },
        { design: "RD07", weight: 4.5, price: 1900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-silver-new.jpg" },
        { design: "Customised", weight: 7.5, price: 4000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8.jpg" },
      ],
      "22k-yellow": [
        { design: "RD01", weight: 4.5, price: 61500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-gold.jpg" },
        { design: "RD02", weight: 4.5, price: 81500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-gold.jpg" },
        { design: "RD03", weight: 4.5, price: 115500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-gold.jpg" },
        { design: "RD04", weight: 4.5, price: 68500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-gold.jpg" },
        { design: "RD05", weight: 4.5, price: 61500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-gold.jpg" },
        { design: "RD06", weight: 4.5, price: 76500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-gold.jpg" },
        { design: "RD07", weight: 4.5, price: 68500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-gold-new.jpg" },
        { design: "Customised", weight: 7.5, price: 123500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8.jpg" },
      ],
      "18k-yellow": [
        { design: "RD01", weight: 4.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-gold_1.jpg" },
        { design: "RD02", weight: 4.5, price: 72500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-gold_1.jpg" },
        { design: "RD03", weight: 4.5, price: 97500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-gold_1.jpg" },
        { design: "RD04", weight: 4.5, price: 62500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-gold_1.jpg" },
        { design: "RD05", weight: 4.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-gold_1.jpg" },
        { design: "RD06", weight: 4.5, price: 67500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-gold_1.jpg" },
        { design: "RD07", weight: 4.5, price: 62500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-gold-new_1.jpg" },
        { design: "Customised", weight: 7.5, price: 102500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8_2.jpg" },
      ],
      "18k-white": [
        { design: "RD01", weight: 4.5, price: 74500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-silver_1.jpg" },
        { design: "RD02", weight: 4.5, price: 94500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-silver_1.jpg" },
        { design: "RD03", weight: 4.5, price: 123500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-silver_1.jpg" },
        { design: "RD04", weight: 4.5, price: 84500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-silver_1.jpg" },
        { design: "RD05", weight: 4.5, price: 74500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-silver_1.jpg" },
        { design: "RD06", weight: 4.5, price: 87500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-silver_1.jpg" },
        { design: "RD07", weight: 4.5, price: 84500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-silver-new_1.jpg" },
        { design: "Customised", weight: 7.5, price: 128500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8.jpg" },
      ],
      "14k-yellow": [
        { design: "RD01", weight: 4.5, price: 63500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-gold_3.jpg" },
        { design: "RD02", weight: 4.5, price: 85500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-gold_2.jpg" },
        { design: "RD03", weight: 4.5, price: 119500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-gold_2.jpg" },
        { design: "RD04", weight: 4.5, price: 72500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-gold_2.jpg" },
        { design: "RD05", weight: 4.5, price: 63500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-gold_2.jpg" },
        { design: "RD06", weight: 4.5, price: 80500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-gold_2.jpg" },
        { design: "RD07", weight: 4.5, price: 72500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-gold-new_2.jpg" },
        { design: "Customised", weight: 7.5, price: 123500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8_6.jpg" },
      ],
      "14k-white": [
        { design: "RD01", weight: 4.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd1-silver_3.jpg" },
        { design: "RD02", weight: 4.5, price: 68500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd2-silver_3.jpg" },
        { design: "RD03", weight: 4.5, price: 93500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd3-silver_2.jpg" },
        { design: "RD04", weight: 4.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd4-silver_2.jpg" },
        { design: "RD05", weight: 4.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd5-silver_2.jpg" },
        { design: "RD06", weight: 4.5, price: 63500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd6-silver_2.jpg" },
        { design: "RD07", weight: 4.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd7-silver-new_2.jpg" },
        { design: "Customised", weight: 7.5, price: 97500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_8_4.jpg" },
      ],
    },
    pendant: {
      silver: [
        { design: "PD11", weight: 2, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-silver_1.jpg" },
        { design: "PD12", weight: 2, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-silver_1.jpg" },
        { design: "PD13", weight: 2, price: 3000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-silver_1.jpg" },
        { design: "PD14", weight: 2, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-silver_1.jpg" },
        { design: "PD15", weight: 2, price: 3000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-silver_1.jpg" },
        { design: "PD16", weight: 2, price: 1900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-silver_1.jpg" },
        { design: "PD17", weight: 2, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-silver_1.jpg" },
        { design: "Customised", weight: 7.5, price: 3500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9.jpg" },
      ],
      "22k-yellow": [
        { design: "PD11", weight: 2.5, price: 45500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-gold_3.jpg" },
        { design: "PD12", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-gold_3.jpg" },
        { design: "PD13", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-gold_3.jpg" },
        { design: "PD14", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-gold_3.jpg" },
        { design: "PD15", weight: 2.5, price: 54500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-gold_3.jpg" },
        { design: "PD16", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-gold_3.jpg" },
        { design: "PD17", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-gold_3.jpg" },
        { design: "Customised", weight: 7.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9.jpg" },
      ],
      "18k-yellow": [
        { design: "PD11", weight: 2.5, price: 45500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-gold_1.jpg" },
        { design: "PD12", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-gold_1.jpg" },
        { design: "PD13", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-gold_1.jpg" },
        { design: "PD14", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-gold_1.jpg" },
        { design: "PD15", weight: 2.5, price: 52500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-gold_1.jpg" },
        { design: "PD16", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-gold_1.jpg" },
        { design: "PD17", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-gold_1.jpg" },
        { design: "Customised", weight: 7.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9_1.jpg" },
      ],
      "18k-white": [
        { design: "PD11", weight: 2.5, price: 50700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-silver_2.jpg" },
        { design: "PD12", weight: 2.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-silver_2.jpg" },
        { design: "PD13", weight: 2.5, price: 55500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-silver_2.jpg" },
        { design: "PD14", weight: 2.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-silver_2.jpg" },
        { design: "PD15", weight: 2.5, price: 61500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-silver_2.jpg" },
        { design: "PD16", weight: 2.5, price: 55500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-silver_2.jpg" },
        { design: "PD17", weight: 2.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-silver_2.jpg" },
        { design: "Customised", weight: 7.5, price: 63500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9.jpg" },
      ],
      "14k-yellow": [
        { design: "PD11", weight: 2.5, price: 48100, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-gold_2.jpg" },
        { design: "PD12", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-gold_2.jpg" },
        { design: "PD13", weight: 2.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-gold_2.jpg" },
        { design: "PD14", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-gold_2.jpg" },
        { design: "PD15", weight: 2.5, price: 58500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-gold_2.jpg" },
        { design: "PD16", weight: 2.5, price: 53500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-gold_2.jpg" },
        { design: "PD17", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-gold_2.jpg" },
        { design: "Customised", weight: 7.5, price: 61500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9_3.jpg" },
      ],
      "14k-white": [
        { design: "PD11", weight: 2.5, price: 42900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd1-silver_3.jpg" },
        { design: "PD12", weight: 2.5, price: 45500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd2-silver_3.jpg" },
        { design: "PD13", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd3-silver_3.jpg" },
        { design: "PD14", weight: 2.5, price: 45500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd4-silver_3.jpg" },
        { design: "PD15", weight: 2.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd5-silver_3.jpg" },
        { design: "PD16", weight: 2.5, price: 48500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd6-silver_3.jpg" },
        { design: "PD17", weight: 2.5, price: 45500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd7-silver_3.jpg" },
        { design: "Customised", weight: 7.5, price: 50500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_9_2.jpg" },
      ],
    },
  },
  default: {
    ring: {
      silver: [
        { design: "RD11", weight: 4.5, price: 2000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_silver_2.jpg" },
        { design: "RD21", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_silver_2.jpg" },
        { design: "RD23", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_silver_2.jpg" },
        { design: "RD24", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_silver_2.jpg" },
        { design: "RD25", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_silver_2.jpg" },
        { design: "RD26", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_silver_2.jpg" },
        { design: "RD27", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_silver_3.jpg" },
        { design: "RD30", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_silver_2.jpg" },
        { design: "RD31", weight: 4.5, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_silver_2.jpg" },
        { design: "RD32", weight: 4.5, price: 3000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_silver_1.jpg" },
        { design: "RD34", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_silver_1.jpg" },
        { design: "RD36", weight: 4.5, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_silver_1.jpg" },
        { design: "RD37", weight: 4.5, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_silver_1.jpg" },
        { design: "RD39", weight: 4.5, price: 2000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_silver_2.jpg" },
        { design: "RD40", weight: 4.5, price: 2000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_silver_2.jpg" },
        { design: "Customised", weight: 7.5, price: 4000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      copper: [
        { design: "RD25", weight: 4.5, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_copper_2.jpg" },
        { design: "RD40", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_copper_1.jpg" },
        { design: "Customised", weight: 7.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      "22k-yellow": [
        { design: "RD11", weight: 4.5, price: 102000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_panchdhatu_3.jpg" },
        { design: "RD21", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_panchdhatu_3.jpg" },
        { design: "RD23", weight: 4.5, price: 57000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_panchdhatu_3.jpg" },
        { design: "RD24", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_panchdhatu_3.jpg" },
        { design: "RD25", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_panchdhatu_4.jpg" },
        { design: "RD26", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_panchdhatu_5.jpg" },
        { design: "RD27", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_panchdhatu_4.jpg" },
        { design: "RD30", weight: 4.5, price: 86000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_panchdhatu_3.jpg" },
        { design: "RD31", weight: 4.5, price: 142000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_panchdhatu_2.jpg" },
        { design: "RD32", weight: 4.5, price: 130000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_panchdhatu_2.jpg" },
        { design: "RD34", weight: 4.5, price: 57000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_panchdhatu_2.jpg" },
        { design: "RD36", weight: 4.5, price: 142000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_panchdhatu_2.jpg" },
        { design: "RD37", weight: 4.5, price: 130000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_panchdhatu_2.jpg" },
        { design: "RD39", weight: 4.5, price: 102000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_panchdhatu_2.jpg" },
        { design: "RD40", weight: 4.5, price: 116000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_panchdhatu_2.jpg" },
        { design: "Customised", weight: 7.5, price: 155000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      "18k-yellow": [
        { design: "RD11", weight: 4.5, price: 87000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_panchdhatu_4.jpg" },
        { design: "RD21", weight: 4.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_panchdhatu_4.jpg" },
        { design: "RD23", weight: 4.5, price: 51000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_panchdhatu_4.jpg" },
        { design: "RD24", weight: 4.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_panchdhatu_4.jpg" },
        { design: "RD25", weight: 4.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_panchdhatu_5.jpg" },
        { design: "RD26", weight: 4.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_panchdhatu_4.jpg" },
        { design: "RD27", weight: 4.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_panchdhatu_3.jpg" },
        { design: "RD30", weight: 4.5, price: 74000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_panchdhatu_4.jpg" },
        { design: "RD31", weight: 4.5, price: 126000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_panchdhatu_3.jpg" },
        { design: "RD32", weight: 4.5, price: 114000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_panchdhatu_3.jpg" },
        { design: "RD34", weight: 4.5, price: 51000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_panchdhatu_3.jpg" },
        { design: "RD36", weight: 4.5, price: 126000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_panchdhatu_3.jpg" },
        { design: "RD37", weight: 4.5, price: 114000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_panchdhatu_3.jpg" },
        { design: "RD39", weight: 4.5, price: 90000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_panchdhatu_3.jpg" },
        { design: "RD40", weight: 4.5, price: 102000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_panchdhatu_3.jpg" },
        { design: "Customised", weight: 7.5, price: 138000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      "18k-white": [
        { design: "RD11", weight: 4.5, price: 82000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_silver_3.jpg" },
        { design: "RD21", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_silver_3.jpg" },
        { design: "RD23", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_silver_3.jpg" },
        { design: "RD24", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_silver_3.jpg" },
        { design: "RD25", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_silver_3.jpg" },
        { design: "RD26", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_silver_4.jpg" },
        { design: "RD27", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_silver_4.jpg" },
        { design: "RD30", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_silver_3.jpg" },
        { design: "RD31", weight: 4.5, price: 118000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_silver_3.jpg" },
        { design: "RD32", weight: 4.5, price: 106000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_silver_2.jpg" },
        { design: "RD34", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_silver_2.jpg" },
        { design: "RD36", weight: 4.5, price: 118000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_silver_2.jpg" },
        { design: "RD37", weight: 4.5, price: 106000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_silver_2.jpg" },
        { design: "RD39", weight: 4.5, price: 82000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_silver_3.jpg" },
        { design: "RD40", weight: 4.5, price: 95000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_silver_3.jpg" },
        { design: "Customised", weight: 7.5, price: 130000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      "14k-yellow": [
        { design: "RD11", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_panchdhatu_5.jpg" },
        { design: "RD21", weight: 4.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_panchdhatu_5.jpg" },
        { design: "RD23", weight: 4.5, price: 42000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_panchdhatu_5.jpg" },
        { design: "RD24", weight: 4.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_panchdhatu_5.jpg" },
        { design: "RD25", weight: 4.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_panchdhatu_6.jpg" },
        { design: "RD26", weight: 4.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_panchdhatu_6.jpg" },
        { design: "RD27", weight: 4.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_panchdhatu_5.jpg" },
        { design: "RD30", weight: 4.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_panchdhatu_5.jpg" },
        { design: "RD31", weight: 4.5, price: 102000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_panchdhatu_4.jpg" },
        { design: "RD32", weight: 4.5, price: 90000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_panchdhatu_4.jpg" },
        { design: "RD34", weight: 4.5, price: 42000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_panchdhatu_4.jpg" },
        { design: "RD36", weight: 4.5, price: 102000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_panchdhatu_5.jpg" },
        { design: "RD37", weight: 4.5, price: 90000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_panchdhatu_4.jpg" },
        { design: "RD39", weight: 4.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_panchdhatu_4.jpg" },
        { design: "RD40", weight: 4.5, price: 78000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_panchdhatu_4.jpg" },
        { design: "Customised", weight: 7.5, price: 114000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      "14k-white": [
        { design: "RD11", weight: 4.5, price: 66000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_silver_4.jpg" },
        { design: "RD21", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_5.jpg" },
        { design: "RD23", weight: 4.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_silver_4.jpg" },
        { design: "RD24", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_silver_4.jpg" },
        { design: "RD25", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_silver_6.jpg" },
        { design: "RD26", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_silver_7.jpg" },
        { design: "RD27", weight: 4.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_silver_6.jpg" },
        { design: "RD30", weight: 4.5, price: 56000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_silver_4.jpg" },
        { design: "RD31", weight: 4.5, price: 94000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_silver_4.jpg" },
        { design: "RD32", weight: 4.5, price: 83000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_silver_3.jpg" },
        { design: "RD34", weight: 4.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_silver_3.jpg" },
        { design: "RD36", weight: 4.5, price: 94000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_silver_3.jpg" },
        { design: "RD37", weight: 4.5, price: 82000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_silver_3.jpg" },
        { design: "RD39", weight: 4.5, price: 66000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_silver_4.jpg" },
        { design: "RD40", weight: 4.5, price: 74000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_silver_4.jpg" },
        { design: "Customised", weight: 7.5, price: 106000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      panchdhatu: [
        { design: "RD11", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd11_panchdhatu_2.jpg" },
        { design: "RD21", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd21_panchdhatu_2.jpg" },
        { design: "RD23", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd23_panchdhatu_2.jpg" },
        { design: "RD24", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd24_panchdhatu_2.jpg" },
        { design: "RD25", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd25_panchdhatu_3.jpg" },
        { design: "RD26", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd26_panchdhatu_3.jpg" },
        { design: "RD27", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd27_panchdhatu_2.jpg" },
        { design: "RD30", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd30_panchdhatu_2.jpg" },
        { design: "RD31", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd31_panchdhatu_1.jpg" },
        { design: "RD32", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd32_panchdhatu_1.jpg" },
        { design: "RD34", weight: 4.5, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd34_panchdhatu_1.jpg" },
        { design: "RD36", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd36_panchdhatu_1.jpg" },
        { design: "RD37", weight: 4.5, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd37_panchdhatu_1.jpg" },
        { design: "RD39", weight: 4.5, price: 1200, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd39_panchdhatu_1.jpg" },
        { design: "RD40", weight: 4.5, price: 1200, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/r/d/rd40_panchdhatu_1.jpg" },
        { design: "Customised", weight: 7.5, price: 3000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_1.jpg" },
      ],
    },
    pendant: {
      silver: [
        { design: "PD01", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-silver.jpg" },
        { design: "PD02", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-silver.jpg" },
        { design: "PD03", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-silver.jpg" },
        { design: "PD04", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-silver.jpg" },
        { design: "PD05", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-silver.jpg" },
        { design: "PD06", weight: 2, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-silver.jpg" },
        { design: "PD08", weight: 2, price: 1500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-silver.jpg" },
        { design: "Customised", weight: 7.5, price: 2500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4.jpg" },
      ],
      copper: [
        { design: "PD02", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-copper_1.jpg" },
        { design: "PD03", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-copper_9.jpg" },
        { design: "PD06", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-copper_1.jpg" },
        { design: "Customised", weight: 7.5, price: 1200, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_4.jpg" },
      ],
      "22k-yellow": [
        { design: "PD01", weight: 2.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-panchdhatu_2.jpg" },
        { design: "PD02", weight: 2.5, price: 57000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-panchdhatu_2.jpg" },
        { design: "PD03", weight: 2.5, price: 57000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-panchdhatu_2.jpg" },
        { design: "PD04", weight: 2.5, price: 46000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-panchdhatu_2.jpg" },
        { design: "PD05", weight: 2.5, price: 46000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-panchdhatu_2.jpg" },
        { design: "PD06", weight: 2.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-panchdhatu_2.jpg" },
        { design: "PD08", weight: 2.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-panchdhatu_2.jpg" },
        { design: "Customised", weight: 7.5, price: 82000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56.jpg" },
      ],
      "18k-yellow": [
        { design: "PD01", weight: 2.5, price: 45000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-panchdhatu_3.jpg" },
        { design: "PD02", weight: 2.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-panchdhatu_3.jpg" },
        { design: "PD03", weight: 2.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-panchdhatu_3.jpg" },
        { design: "PD04", weight: 2.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-panchdhatu_3.jpg" },
        { design: "PD05", weight: 2.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-panchdhatu_3.jpg" },
        { design: "PD06", weight: 2.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-panchdhatu_3.jpg" },
        { design: "PD08", weight: 2.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-panchdhatu_3.jpg" },
        { design: "Customised", weight: 7.5, price: 75000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_2.jpg" },
      ],
      "18k-white": [
        { design: "PD01", weight: 2.5, price: 42000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-silver_4.jpg" },
        { design: "PD02", weight: 2.5, price: 46000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-silver_3.jpg" },
        { design: "PD03", weight: 2.5, price: 46000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-silver_3.jpg" },
        { design: "PD04", weight: 2.5, price: 35000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-silver_3.jpg" },
        { design: "PD05", weight: 2.5, price: 35000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-silver_3.jpg" },
        { design: "PD06", weight: 2.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-silver_3.jpg" },
        { design: "PD08", weight: 2.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-silver_3.jpg" },
        { design: "Customised", weight: 7.5, price: 70000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_1.jpg" },
      ],
      "14k-yellow": [
        { design: "PD01", weight: 2.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-panchdhatu_4.jpg" },
        { design: "PD02", weight: 2.5, price: 42000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-panchdhatu_4.jpg" },
        { design: "PD03", weight: 2.5, price: 42000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-panchdhatu_4.jpg" },
        { design: "PD04", weight: 2.5, price: 32000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-panchdhatu_4.jpg" },
        { design: "PD05", weight: 2.5, price: 32000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-panchdhatu_4.jpg" },
        { design: "PD06", weight: 2.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-panchdhatu_4.jpg" },
        { design: "PD08", weight: 2.5, price: 50000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-panchdhatu_4.jpg" },
        { design: "Customised", weight: 7.5, price: 62000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_4.jpg" },
      ],
      "14k-white": [
        { design: "PD01", weight: 2.5, price: 35000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-silver_5.jpg" },
        { design: "PD02", weight: 2.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-silver_4.jpg" },
        { design: "PD03", weight: 2.5, price: 38000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-silver_4.jpg" },
        { design: "PD04", weight: 2.5, price: 30000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-silver_4.jpg" },
        { design: "PD05", weight: 2.5, price: 30000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-silver_4.jpg" },
        { design: "PD06", weight: 2.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-silver_4.jpg" },
        { design: "PD08", weight: 2.5, price: 47000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-silver_4.jpg" },
        { design: "Customised", weight: 7.5, price: 58000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_3.jpg" },
      ],
      panchdhatu: [
        { design: "PD01", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd01-panchdhatu_4.jpg" },
        { design: "PD02", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd02-panchdhatu_4.jpg" },
        { design: "PD03", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd03-panchdhatu_4.jpg" },
        { design: "PD04", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd04-panchdhatu_4.jpg" },
        { design: "PD05", weight: 2, price: 700, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd05-panchdhatu_4.jpg" },
        { design: "PD06", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd06-panchdhatu_4.jpg" },
        { design: "PD08", weight: 2, price: 900, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/p/d/pd08-panchdhatu_4.jpg" },
        { design: "Customised", weight: 7.5, price: 2000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/c/u/custom_design_19_4_56_4.jpg" },
      ],
    },
    bracelet: {
      silver: [
        { design: "BR01", weight: 10, price: 4500, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/b/r/br01_11.jpg" },
        { design: "BR02", weight: 10, price: 15000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/b/r/br02_7.jpg" },
        { design: "BR08", weight: 10, price: 12000, image: "https://z380ss4m.cdn.imgeng.in/media/attribute/swatch/swatch_thumb/200x200/b/r/br08_5.jpg" },
      ],
    },
  },
};

// Used by pricing.server.js's computeTrustedQuote() — the App Proxy's
// server-side price recomputation that never trusts a client-sent total.
// Looks up one design's catalog entry by type/metal/design code, falling
// back to null (caller throws QuoteError) when nothing matches — same
// contract as before this file was regenerated.
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
