/**
 * Server-side ported copy of the global fallback design catalog defined in
 * the theme's snippets/shubh-gems-global-designs.liquid (as of the
 * "product" theme, #190151065899, Aug 2026). This is the catalog used when
 * a gemstone product has no product-specific ring_designs/pandent_designs/
 * bracelet_designs metaobject entries for the selected metal.
 *
 * WHY THIS IS A COPY, NOT LIVE DATA: Shopify's storefront Liquid doesn't
 * expose arbitrary URL query parameters to templates, so there's no way for
 * this backend to ask the theme "what's the weight/price for ring + Silver
 * + RD11" on demand. This table has to be an authoritative, backend-owned
 * copy instead.
 *
 * KEEPING THIS IN SYNC: if the design table in
 * snippets/shubh-gems-global-designs.liquid is ever edited (new designs,
 * changed weights/prices), this file must be updated to match by hand —
 * there is no automatic sync. Consider this the single known maintenance
 * trap in this system.
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

const CUSTOM_10 = { design: "Customised", weight: 10, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" };
const CUSTOM_8 = { design: "Customised", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" };

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
        CUSTOM_10,
      ],
      "22k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-white": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-silver.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-silver.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-silver.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-silver.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-silver.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-silver.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-silver.jpg" },
        CUSTOM_10,
      ],
      "14k-yellow": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-gold.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-gold.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-gold.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-gold.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-gold.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-gold.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-gold.jpg" },
        CUSTOM_10,
      ],
      "14k-white": [
        { design: "RD01", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD1-silver.jpg" },
        { design: "RD02", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD2-silver.jpg" },
        { design: "RD03", weight: 8, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD3-silver.jpg" },
        { design: "RD04", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD4-silver.jpg" },
        { design: "RD05", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD5-silver.jpg" },
        { design: "RD06", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD6-silver.jpg" },
        { design: "RD07", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD7-silver.jpg" },
        CUSTOM_10,
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
        CUSTOM_8,
      ],
      "22k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-white": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-silver.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-silver.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-silver.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-silver.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-silver.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-silver.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-silver.jpg" },
        CUSTOM_10,
      ],
      "14k-yellow": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-gold.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-gold.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-gold.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-gold.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-gold.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-gold.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-gold.jpg" },
        CUSTOM_10,
      ],
      "14k-white": [
        { design: "PD11", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD11-silver.jpg" },
        { design: "PD12", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD12-silver.jpg" },
        { design: "PD13", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD13-silver.jpg" },
        { design: "PD14", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD14-silver.jpg" },
        { design: "PD15", weight: 7, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD15-silver.jpg" },
        { design: "PD16", weight: 5, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD16-silver.jpg" },
        { design: "PD17", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD17-silver.jpg" },
        CUSTOM_10,
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
        CUSTOM_10,
      ],
      copper: [
        { design: "RD25", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Copper.jpg" },
        { design: "RD40", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Copper.jpg" },
        { design: "Customised", price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
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
        CUSTOM_10,
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
        CUSTOM_10,
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
        CUSTOM_10,
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
        CUSTOM_10,
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
        CUSTOM_10,
      ],
      panchdhatu: [
        { design: "RD11", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg" },
        { design: "RD21", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg" },
        { design: "RD23", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg" },
        { design: "RD24", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg" },
        { design: "RD25", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg" },
        { design: "RD26", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg" },
        { design: "RD27", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg" },
        { design: "RD30", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg" },
        { design: "RD31", price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg" },
        { design: "RD32", price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg" },
        { design: "RD34", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg" },
        { design: "RD36", price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg" },
        { design: "RD37", price: 1500, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg" },
        { design: "RD39", price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg" },
        { design: "RD40", price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg" },
        { design: "Customised", price: 3000, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
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
        CUSTOM_8,
      ],
      "22k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        CUSTOM_10,
      ],
      "18k-white": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg" },
        CUSTOM_10,
      ],
      "14k-yellow": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        CUSTOM_10,
      ],
      "14k-white": [
        { design: "PD01", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg" },
        { design: "PD02", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg" },
        { design: "PD03", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg" },
        { design: "PD04", weight: 3, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg" },
        { design: "PD05", weight: 4, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg" },
        { design: "PD06", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg" },
        { design: "PD08", weight: 6, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg" },
        CUSTOM_10,
      ],
      panchdhatu: [
        { design: "PD01", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg" },
        { design: "PD02", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg" },
        { design: "PD03", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg" },
        { design: "PD04", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg" },
        { design: "PD05", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg" },
        { design: "PD06", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg" },
        { design: "PD08", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg" },
        { design: "Customised", price: 2000, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
      ],
      copper: [
        { design: "PD02", weight: 2, price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-copper.jpg" },
        { design: "PD03", price: 700, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg" },
        { design: "PD06", price: 900, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg" },
        { design: "Customised", price: 1200, image: "https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg" },
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

/**
 * Looks up a design's {weight, price} by type/metal/design code, matching
 * the Liquid fallback's behavior (design_set 'pearl' vs default catalogs).
 * Returns null if not found (caller should treat that as a validation
 * failure — an unrecognized design code should never silently price at 0).
 */
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
