// Parses snippets/shubh-gems-global-designs.liquid and extracts the exact
// design_set -> type -> metal -> [designs] structure as real data, by
// pulling each {% capture json_str %}...{% endcapture %} block's JSON
// content directly (not manual transcription) and mapping each `metal
// contains 'X'` condition to the same metalKeyFor() bucket the JS uses.
//
// USAGE — re-sync app/data/globalDesigns.server.js after the theme's
// design catalog changes (new designs, changed weights/prices/images):
//   1. Pull the LIVE theme's snippet fresh (read the actual charged
//      prices, not a stale local copy):
//        shopify theme pull --theme=189200892203 --store=0f9yd0-jr.myshopify.com \
//          --only="snippets/shubh-gems-global-designs.liquid" --path=./tmp-pull --force
//   2. node scripts/extract-designs.js ./tmp-pull/snippets/shubh-gems-global-designs.liquid ./parsed.json
//   3. node scripts/generate-globaldesigns.js ./parsed.json ./app/data/globalDesigns.server.js
//   4. Diff/spot-check a few entries against the theme file, then rebuild
//      and redeploy.
// This exists because a hand-maintained copy of this catalog drifted
// significantly from the live theme's actual data (wrong weights, missing
// prices, wrong image domain) — every product repriced through this app
// was charging the wrong price relative to what the storefront customizer
// displayed. Never hand-edit globalDesigns.server.js directly — regenerate
// it instead, so drift can't creep back in one manual edit at a time.
const fs = require("fs");

const src = fs.readFileSync(process.argv[2], "utf-8");

// Map a `metal contains 'a' [and/or metal contains 'b']` condition string
// to the metalKeyFor() bucket, using the exact same rules as the JS file.
function metalKeyForCondition(cond) {
  const c = cond.toLowerCase();
  const has = (s) => c.includes(`metal contains '${s}'`);
  if (has("silver") || has("chandi")) return "silver";
  if (has("panchdhatu")) return "panchdhatu";
  if (has("copper") || has("tamba")) return "copper";
  if (has("22k") && has("yellow")) return "22k-yellow";
  if (has("18k") && has("yellow")) return "18k-yellow";
  if (has("18k") && has("white")) return "18k-white";
  if (has("14k") && has("yellow")) return "14k-yellow";
  if (has("14k") && has("white")) return "14k-white";
  throw new Error("Unrecognized metal condition: " + cond);
}

function typeKeyForCondition(cond) {
  if (cond.includes("'ring'")) return "ring";
  if (cond.includes("'pendant'")) return "pendant";
  if (cond.includes("'bracelet'")) return "bracelet";
  throw new Error("Unrecognized type condition: " + cond);
}

// Split top-level on {%- else -%} that follows the design_set=='pearl' if,
// at the OUTERMOST nesting only. Find the outermost if/else/endif by
// tracking depth of if/elsif/endif tokens that are metal/type/design_set
// conditions (all the ifs in this file are these three kinds).
const tokenRe = /\{%-\s*(if|elsif|else|endif)\b([^%]*)-%\}/g;
let depth = 0;
let pearlEnd = -1;
let elseStart = -1;
let m;
const positions = [];
while ((m = tokenRe.exec(src))) {
  positions.push({ kind: m[1], cond: m[2].trim(), index: m.index, end: tokenRe.lastIndex });
}

// First token must be the design_set if.
if (positions[0].kind !== "if" || !positions[0].cond.includes("design_set")) {
  throw new Error("Expected outer design_set if first, got: " + JSON.stringify(positions[0]));
}
depth = 1;
let outerElseIdx = null;
let outerEndIdx = null;
for (let i = 1; i < positions.length; i++) {
  const p = positions[i];
  if (p.kind === "if") depth++;
  else if (p.kind === "endif") {
    depth--;
    if (depth === 0) {
      outerEndIdx = i;
      break;
    }
  } else if (p.kind === "else" && depth === 1) {
    outerElseIdx = i;
  }
}
if (outerElseIdx === null || outerEndIdx === null) throw new Error("Could not find outer else/endif");

const pearlSection = src.slice(positions[0].end, positions[outerElseIdx].index);
const defaultSection = src.slice(positions[outerElseIdx].end, positions[outerEndIdx].index);

function parseSection(section) {
  // Within a design_set section: sequence of `{%- if type contains 'X' -%}
  // ... {%- endif -%}` blocks (siblings, not nested in each other).
  const result = {};
  const typeBlockRe = /\{%-\s*if\s+type contains '(\w+)' -%\}([\s\S]*?)\n {2}\{%-\s*endif\s*-%\}/g;
  let tm;
  while ((tm = typeBlockRe.exec(section))) {
    const typeKey = tm[1] === "pendant" ? "pendant" : tm[1]; // ring/pendant/bracelet
    const body = tm[2];
    result[typeKey] = parseMetalChain(body);
  }
  return result;
}

function parseMetalChain(body) {
  const metals = {};
  // Each metal branch: `{%- if metal contains ... -%}` or `{%- elsif metal
  // contains ... -%}`, followed by a capture json_str block.
  const branchRe = /\{%-\s*(?:if|elsif)\s+(metal contains[^%]*)-%\}\s*\{%-\s*capture json_str\s*-%\}([\s\S]*?)\{%-\s*endcapture\s*-%\}/g;
  let bm;
  while ((bm = branchRe.exec(body))) {
    const cond = bm[1].trim();
    const jsonRaw = bm[2];
    const metalKey = metalKeyForCondition(cond);
    let parsed;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch (e) {
      throw new Error(`JSON parse failed for metal condition "${cond}": ${e.message}\n---\n${jsonRaw.slice(0, 300)}`);
    }
    metals[metalKey] = parsed;
  }
  return metals;
}

const pearl = parseSection(pearlSection);
const defaultDesigns = parseSection(defaultSection);

const out = { pearl, default: defaultDesigns };
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2), "utf-8");

// Print a quick summary for sanity-checking.
for (const [setName, set] of Object.entries(out)) {
  console.log(`\n=== ${setName} ===`);
  for (const [typeName, metals] of Object.entries(set)) {
    console.log(`  ${typeName}: ${Object.keys(metals).join(", ")}`);
    for (const [metalKey, designs] of Object.entries(metals)) {
      console.log(`    ${metalKey}: ${designs.length} designs`);
    }
  }
}
