/**
 * ONE-TIME migration: adds "Design" as a 3rd real variant option on the
 * "test" product, alongside the existing "Customised" (Type) and
 * "Metals" options — so Type+Metal+Design resolves to a single real,
 * correctly-priced variant instead of needing a separate addon line.
 *
 * Prices are computed from the SAME design catalog data already live in
 * the theme (shubh-gems-global-designs.liquid) plus the current metal
 * rates from config/settings_data.json — this is a SNAPSHOT, not a live
 * formula. If metal rates change later, re-running this same route
 * recomputes and bulk-updates every affected variant's price in one
 * shot (see "reprice" mode below) — that's the "dynamic on demand"
 * mechanism agreed on, not per-request live computation (which needs
 * Shopify Plus and wasn't available here).
 *
 * Protected by a secret embedded directly in this file (not an env var —
 * avoids needing any Render dashboard changes for a route meant to be
 * run once, then deleted). Never exposed to the client; this is a
 * server-only Remix loader.
 *
 *   GET /admin/migrate-design-variants?secret=<MIGRATION_SECRET>
 *   GET /admin/migrate-design-variants?secret=<MIGRATION_SECRET>&mode=reprice
 */
import shopify from "../shopify.server";
import db from "../db.server";

const MIGRATION_SECRET = "56f55c3521aaca77197b3dba1c57c3c33908e08aa857e893";

const PRODUCT_ID_NUMERIC = "10522275741995"; // "test" product

const RATES = {
  Silver: 400,
  Panchdhatu: 0,
  Copper: 0,
  "22k Yellow Gold": 16000,
  "18K Yellow Gold": 13200,
  "18K White Gold": 13700,
  "14K Yellow Gold": 10500,
  "14K White Gold": 10900,
};
const MAKING_CHARGE_PER_GRAM = 1500;

const CATALOG = {
  "Ring|Silver": [{"design":"RD11","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg"},{"design":"RD21","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg"},{"design":"RD23","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg"},{"design":"RD24","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg"},{"design":"RD25","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg"},{"design":"RD26","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg"},{"design":"RD27","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg"},{"design":"RD30","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg"},{"design":"RD31","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg"},{"design":"RD32","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg"},{"design":"RD34","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg"},{"design":"RD36","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg"},{"design":"RD37","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg"},{"design":"RD39","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg"},{"design":"RD40","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Ring|Panchdhatu": [{"design":"RD11","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg","price":900},{"design":"RD21","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg","price":900},{"design":"RD23","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg","price":900},{"design":"RD24","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg","price":900},{"design":"RD25","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg","price":900},{"design":"RD26","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg","price":900},{"design":"RD27","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg","price":900},{"design":"RD30","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg","price":900},{"design":"RD31","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg","price":1500},{"design":"RD32","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg","price":1500},{"design":"RD34","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg","price":900},{"design":"RD36","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg","price":1500},{"design":"RD37","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg","price":1500},{"design":"RD39","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg","price":1200},{"design":"RD40","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg","price":1200},{"design":"Customised","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg","price":3000}],
  "Ring|Copper": [{"design":"RD25","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Copper.jpg","price":700},{"design":"RD40","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Copper.jpg","price":900},{"design":"Customised","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg","price":1500}],
  "Ring|22k Yellow Gold": [{"design":"RD11","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg"},{"design":"RD21","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg"},{"design":"RD23","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg"},{"design":"RD24","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg"},{"design":"RD25","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg"},{"design":"RD26","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg"},{"design":"RD27","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg"},{"design":"RD30","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg"},{"design":"RD31","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg"},{"design":"RD32","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg"},{"design":"RD34","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg"},{"design":"RD36","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg"},{"design":"RD37","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg"},{"design":"RD39","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg"},{"design":"RD40","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Ring|18K Yellow Gold": [{"design":"RD11","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg"},{"design":"RD21","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg"},{"design":"RD23","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg"},{"design":"RD24","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg"},{"design":"RD25","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg"},{"design":"RD26","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg"},{"design":"RD27","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg"},{"design":"RD30","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg"},{"design":"RD31","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg"},{"design":"RD32","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg"},{"design":"RD34","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg"},{"design":"RD36","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg"},{"design":"RD37","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg"},{"design":"RD39","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg"},{"design":"RD40","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Ring|14K Yellow Gold": [{"design":"RD11","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_gold.jpg"},{"design":"RD21","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_gold.jpg"},{"design":"RD23","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_gold.jpg"},{"design":"RD24","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_gold.jpg"},{"design":"RD25","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_gold.jpg"},{"design":"RD26","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_gold.jpg"},{"design":"RD27","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_gold.jpg"},{"design":"RD30","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_gold.jpg"},{"design":"RD31","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_gold.jpg"},{"design":"RD32","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_gold.jpg"},{"design":"RD34","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_gold.jpg"},{"design":"RD36","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_gold.jpg"},{"design":"RD37","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_gold.jpg"},{"design":"RD39","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_gold.jpg"},{"design":"RD40","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Ring|18K White Gold": [{"design":"RD11","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg"},{"design":"RD21","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg"},{"design":"RD23","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg"},{"design":"RD24","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg"},{"design":"RD25","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg"},{"design":"RD26","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg"},{"design":"RD27","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg"},{"design":"RD30","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg"},{"design":"RD31","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg"},{"design":"RD32","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg"},{"design":"RD34","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg"},{"design":"RD36","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg"},{"design":"RD37","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg"},{"design":"RD39","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg"},{"design":"RD40","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Ring|14K White Gold": [{"design":"RD11","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD11_Silver.jpg"},{"design":"RD21","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD21_Silver.jpg"},{"design":"RD23","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD23_Silver.jpg"},{"design":"RD24","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD24_Silver.jpg"},{"design":"RD25","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD25_Silver.jpg"},{"design":"RD26","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD26_Silver.jpg"},{"design":"RD27","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD27_Silver.jpg"},{"design":"RD30","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD30_Silver.jpg"},{"design":"RD31","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD31_Silver.jpg"},{"design":"RD32","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD32_Silver.jpg"},{"design":"RD34","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD34_Silver.jpg"},{"design":"RD36","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD36_Silver.jpg"},{"design":"RD37","weight":7,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD37_Silver.jpg"},{"design":"RD39","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD39_Silver.jpg"},{"design":"RD40","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/RD40_Silver.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Bracelet|Silver": [{"design":"BR01","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br01.jpg"},{"design":"BR02","weight":30,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br02.jpg"},{"design":"BR08","weight":20,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/br08.jpg"}],
  "Pendent|Silver": [{"design":"PD01","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg"},{"design":"PD02","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg"},{"design":"PD03","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg"},{"design":"PD04","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg"},{"design":"PD06","weight":5,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg"},{"design":"Customised","weight":8,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Pendent|Panchdhatu": [{"design":"PD01","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg","price":700},{"design":"PD02","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg","price":700},{"design":"PD03","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg","price":700},{"design":"PD04","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg","price":700},{"design":"PD05","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg","price":700},{"design":"PD06","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg","price":900},{"design":"PD08","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg","price":900},{"design":"Customised","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg","price":2000}],
  "Pendent|Copper": [{"design":"PD02","weight":2,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-copper.jpg","price":700},{"design":"PD03","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg","price":700},{"design":"PD06","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-copper.jpg","price":900},{"design":"Customised","image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg","price":1200}],
  "Pendent|22k Yellow Gold": [{"design":"PD01","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg"},{"design":"PD02","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg"},{"design":"PD03","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg"},{"design":"PD04","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg"},{"design":"PD06","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Pendent|18K Yellow Gold": [{"design":"PD01","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg"},{"design":"PD02","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg"},{"design":"PD03","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg"},{"design":"PD04","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg"},{"design":"PD06","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Pendent|14K Yellow Gold": [{"design":"PD01","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-gold.jpg"},{"design":"PD02","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-gold.jpg"},{"design":"PD03","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-gold.jpg"},{"design":"PD04","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-gold.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-gold.jpg"},{"design":"PD06","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-gold.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-gold.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Pendent|18K White Gold": [{"design":"PD01","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg"},{"design":"PD02","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg"},{"design":"PD03","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg"},{"design":"PD04","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg"},{"design":"PD06","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}],
  "Pendent|14K White Gold": [{"design":"PD01","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD01-silver.jpg"},{"design":"PD02","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD02-silver.jpg"},{"design":"PD03","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD03-silver.jpg"},{"design":"PD04","weight":3,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD04-silver.jpg"},{"design":"PD05","weight":4,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD05-silver.jpg"},{"design":"PD06","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD06-silver.jpg"},{"design":"PD08","weight":6,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/PD08-silver.jpg"},{"design":"Customised","weight":10,"image":"https://cdn.shopify.com/s/files/1/0992/9929/5531/files/custom_design.jpg"}]
};

const LOOSE_METALS = ["Silver", "Panchdhatu", "Copper", "22k Yellow Gold", "18K Yellow Gold", "14K Yellow Gold", "18K White Gold", "14K White Gold"];

function computeVariants() {
  const variants = [];
  const designValues = new Set(["N/A"]);

  // Existing Loose variants — untouched, just need a Design value now that
  // Design becomes a real option on this product.
  for (const metal of LOOSE_METALS) {
    variants.push({ options: ["Loose", metal, "N/A"], price: "10.00" });
  }

  for (const [key, entries] of Object.entries(CATALOG)) {
    const [type, metal] = key.split("|");
    for (const entry of entries) {
      let price;
      if (entry.price) {
        price = entry.price;
      } else if (entry.weight) {
        const rate = RATES[metal] ?? 0;
        price = entry.weight * (rate + MAKING_CHARGE_PER_GRAM);
      } else {
        continue;
      }
      designValues.add(entry.design);
      variants.push({
        options: [type, metal, entry.design],
        price: price.toFixed(2),
        image: entry.image,
      });
    }
  }
  return { variants, designValues: [...designValues] };
}

async function runMigration(admin) {
  const { variants, designValues } = computeVariants();
  const productGid = `gid://shopify/Product/${PRODUCT_ID_NUMERIC}`;

  const input = {
    id: productGid,
    productOptions: [
      { name: "Customised", position: 1, values: ["Loose", "Ring", "Bracelet", "Pendent"].map((v) => ({ name: v })) },
      { name: "Metals", position: 2, values: LOOSE_METALS.map((v) => ({ name: v })) },
      { name: "Design", position: 3, values: designValues.map((v) => ({ name: v })) },
    ],
    variants: variants.map((v) => ({
      optionValues: v.options.map((value, i) => ({
        optionName: ["Customised", "Metals", "Design"][i],
        name: value,
      })),
      price: v.price,
      inventoryPolicy: "CONTINUE",
    })),
  };

  const res = await admin.graphql(
    `#graphql
    mutation SetProductVariants($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id title }
        productSetOperation { id status }
        userErrors { field message }
      }
    }`,
    { variables: { input } },
  );
  const json = await res.json();
  return { requestedVariantCount: variants.length, designValueCount: designValues.length, result: json };
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== MIGRATION_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await db.session.findFirst({ where: { isOnline: false } });
  if (!session) {
    return Response.json({ error: "No shop installed" }, { status: 500 });
  }

  try {
    const { admin } = await shopify.unauthenticated.admin(session.shop);
    const result = await runMigration(admin);
    return Response.json(result);
  } catch (err) {
    console.error("[admin.migrate-design-variants] failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
