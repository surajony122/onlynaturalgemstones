/**
 * Per-stone display details (metal, finger, day, mantra, substitute) that the merchant
 * edits on the app's "Gemstone details" page. Blank = "no override": the astrology API's
 * value / the built-in default is used. Applied in astroAdvice.server.js when a
 * recommendation is built, so the form's result page, the emailed result link, the
 * emails and WhatsApp all show the same values.
 */
import prisma from "../db.server";

// The stones the recommendation can return. `defaults` are only what the Settings page
// shows as grey hints; the actual fallback values live in astroAdvice.server.js
// (GEM_CUSTOM_OVERRIDES + the API's own finger/day).
export const GEM_STONES = [
  { key: "ruby", name: "Ruby", hindi: "Manik", planet: "Sun", defaults: { metal: "Gold or Copper", substitute: "Red Garnet" } },
  { key: "pearl", name: "Pearl", hindi: "Moti", planet: "Moon", defaults: { metal: "Silver or White Gold", substitute: "Moonstone" } },
  { key: "red_coral", name: "Red Coral", hindi: "Moonga", planet: "Mars", defaults: { metal: "Gold or Panchdhatu", substitute: "" } },
  { key: "emerald", name: "Emerald", hindi: "Panna", planet: "Mercury", defaults: { metal: "Gold or Panchdhatu", substitute: "Peridot" } },
  { key: "yellow_sapphire", name: "Yellow Sapphire", hindi: "Pukhraj", planet: "Jupiter", defaults: { metal: "Gold or Panchdhatu", substitute: "Citrine" } },
  { key: "diamond", name: "Diamond", hindi: "Heera", planet: "Venus", defaults: { metal: "Silver or White Gold", substitute: "Opal, White Zircon" } },
  { key: "blue_sapphire", name: "Blue Sapphire", hindi: "Neelam", planet: "Saturn", defaults: { metal: "Gold or Silver", substitute: "Amethyst, Iolite" } },
  { key: "hessonite", name: "Hessonite", hindi: "Gomed", planet: "Rahu", defaults: { metal: "Silver or Panchdhatu", substitute: "" } },
  { key: "cats_eye", name: "Cat's Eye", hindi: "Lehsunia", planet: "Ketu", defaults: { metal: "Silver or Panchdhatu", substitute: "" } },
  { key: "opal", name: "Opal", hindi: "Upal", planet: "Venus", defaults: { metal: "Silver or White Gold", substitute: "White Zircon" } },
];

export const PLANET_MANTRAS = {
  sun: "Om Suryaya Namah",
  moon: "Om Chandraya Namah",
  mars: "Om Angarakaya Namah",
  mercury: "Om Budhaya Namah",
  jupiter: "Om Gurave Namah",
  venus: "Om Shukraya Namah",
  saturn: "Om Shanaye Namah",
  rahu: "Om Rahave Namah",
  ketu: "Om Ketave Namah",
};

export function mantraForPlanet(planet) {
  const p = String(planet || "").toLowerCase();
  for (const k of Object.keys(PLANET_MANTRAS)) if (p.includes(k)) return PLANET_MANTRAS[k];
  return "";
}

/** Normalises whatever key the API/our map uses to one of GEM_STONES' keys. */
export function normaliseGemKey(raw) {
  const k = String(raw || "").toLowerCase().replace(/[\s'-]+/g, "_");
  if (k === "gomed") return "hessonite";
  if (k === "cat_s_eye" || k === "cats_eye" || k === "catseye") return "cats_eye";
  return k;
}

const FIELDS = ["metal", "finger", "day", "mantra", "substitute"];
const clean = (v) => String(v == null ? "" : v).trim().slice(0, 200);

/** { gemKey: { metal, finger, day, mantra, substitute } } -- only non-blank values.
 *  Never throws: a database hiccup must not break a customer's recommendation. */
export async function getGemStoneOverrides(shop) {
  try {
    const rows = await prisma.gemStoneDetail.findMany({ where: { shop } });
    const out = {};
    for (const r of rows) {
      const entry = {};
      for (const f of FIELDS) if (r[f] && String(r[f]).trim()) entry[f] = String(r[f]).trim();
      if (Object.keys(entry).length) out[r.gemKey] = entry;
    }
    return out;
  } catch (err) {
    console.error("[gemStoneDetails] could not load overrides, using defaults:", err);
    return {};
  }
}

/** Rows for the admin page: every stone, with its saved values (blank if none). */
export async function getGemStoneRows(shop) {
  const saved = await prisma.gemStoneDetail.findMany({ where: { shop } });
  const byKey = Object.fromEntries(saved.map((r) => [r.gemKey, r]));
  return GEM_STONES.map((s) => {
    const r = byKey[s.key] || {};
    return {
      key: s.key,
      name: s.name,
      hindi: s.hindi,
      planet: s.planet,
      defaults: { ...s.defaults, mantra: mantraForPlanet(s.planet) },
      values: Object.fromEntries(FIELDS.map((f) => [f, r[f] || ""])),
    };
  });
}

/** rows: { [gemKey]: { metal, finger, day, mantra, substitute } } */
export async function saveGemStoneDetails(shop, rows) {
  const valid = new Set(GEM_STONES.map((s) => s.key));
  for (const [gemKey, vals] of Object.entries(rows || {})) {
    if (!valid.has(gemKey)) continue;
    const data = Object.fromEntries(FIELDS.map((f) => [f, clean(vals && vals[f]) || null]));
    await prisma.gemStoneDetail.upsert({
      where: { shop_gemKey: { shop, gemKey } },
      update: data,
      create: { shop, gemKey, ...data },
    });
  }
}
