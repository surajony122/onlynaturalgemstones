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

// Built-in taglines (shown as the grey hint on the Gemstone details page). The email / WhatsApp
// code keeps its own copy as the fallback -- see GEM_TAGLINE in astroAdvice.server.js.
export const DEFAULT_TAGLINES = {
  ruby: "for Leadership, Vitality & Success",
  pearl: "for Peace, Emotional Balance & Calm",
  red_coral: "for Courage, Strength & Vitality",
  emerald: "for Health, Success & Growth",
  yellow_sapphire: "for Wealth, Wisdom & Prosperity",
  diamond: "for Luxury, Love & Elegance",
  blue_sapphire: "for Good Fortune, Wealth & Success",
  hessonite: "for Protection & Stability",
  cats_eye: "for Protection & Spiritual Insight",
  opal: "for Marital Bliss, Luxury & Pleasure",
};

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

const FIELDS = ["metal", "finger", "day", "mantra", "substitute", "tagline"];
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


/** Rows for the admin page: built-in stones (unless removed) plus custom ones, with saved values. */
export async function getGemStoneRows(shop) {
  const saved = await prisma.gemStoneDetail.findMany({ where: { shop } });
  const byKey = Object.fromEntries(saved.map((r) => [r.gemKey, r]));
  const vals = (r) => Object.fromEntries(FIELDS.map((f) => [f, (r && r[f]) || ""]));
  const rows = GEM_STONES.filter((s) => !(byKey[s.key] && byKey[s.key].hidden)).map((s) => ({
    key: s.key,
    name: s.name,
    hindi: s.hindi,
    planet: s.planet,
    custom: false,
    defaults: { ...s.defaults, mantra: mantraForPlanet(s.planet), tagline: DEFAULT_TAGLINES[s.key] || "" },
    values: vals(byKey[s.key]),
  }));
  for (const r of saved) {
    if (!r.isCustom) continue;
    rows.push({
      key: r.gemKey,
      name: r.label || r.gemKey,
      hindi: r.hindi || "",
      planet: r.planet || "",
      custom: true,
      defaults: { mantra: mantraForPlanet(r.planet) },
      values: vals(r),
    });
  }
  return rows;
}

/** Built-in stones the merchant removed (so they can be added back). */
export async function getHiddenStones(shop) {
  const saved = await prisma.gemStoneDetail.findMany({ where: { shop, hidden: true, isCustom: false } });
  const names = Object.fromEntries(GEM_STONES.map((s) => [s.key, s.name]));
  return saved.filter((r) => names[r.gemKey]).map((r) => ({ key: r.gemKey, name: names[r.gemKey] }));
}

/** rows: { [gemKey]: { metal, finger, day, mantra, substitute } } */
export async function saveGemStoneDetails(shop, rows) {
  const saved = await prisma.gemStoneDetail.findMany({ where: { shop } });
  const valid = new Set([...GEM_STONES.map((s) => s.key), ...saved.filter((r) => r.isCustom).map((r) => r.gemKey)]);
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

/** Add a custom stone, or restore a removed built-in one when only restoreKey is given. */
export async function addGemStone(shop, { name, hindi, planet, restoreKey }) {
  if (restoreKey) {
    if (!GEM_STONES.some((s) => s.key === restoreKey)) throw new Error("Unknown stone");
    await prisma.gemStoneDetail.updateMany({ where: { shop, gemKey: restoreKey }, data: { hidden: false } });
    return;
  }
  const label = clean(name);
  if (!label) throw new Error("Enter the stone name");
  const gemKey = normaliseGemKey(label);
  if (GEM_STONES.some((s) => s.key === gemKey)) throw new Error(label + " is already in the list");
  const meta = { label, hindi: clean(hindi) || null, planet: clean(planet) || null, isCustom: true, hidden: false };
  await prisma.gemStoneDetail.upsert({
    where: { shop_gemKey: { shop, gemKey } },
    update: meta,
    create: { shop, gemKey, ...meta },
  });
}

/** Custom stones are deleted; built-in ones are hidden and their saved details cleared. */
export async function removeGemStone(shop, gemKey) {
  if (GEM_STONES.some((s) => s.key === gemKey)) {
    await prisma.gemStoneDetail.upsert({
      where: { shop_gemKey: { shop, gemKey } },
      update: { hidden: true, metal: null, finger: null, day: null, mantra: null, substitute: null, tagline: null },
      create: { shop, gemKey, hidden: true },
    });
  } else {
    await prisma.gemStoneDetail.deleteMany({ where: { shop, gemKey, isCustom: true } });
  }
}
