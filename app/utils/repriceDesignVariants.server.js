/**
 * Shared logic for (re)pricing the "test" gemstone's Type+Metal+Design
 * variants. Used by both:
 *   - app/routes/app._index.jsx — the "Reprice" button in the app's own
 *     admin screen, the normal way to trigger this from now on.
 *   - app/routes/admin.migrate-design-variants.jsx — the original
 *     secret-URL route, kept as a fallback trigger.
 *
 * Price computed = stone's own price (read live off its "Loose" variant)
 * + the setting/design cost for that Type+Metal+Design combo (explicit
 * catalog price, or weight x (metal rate + making charge) when no
 * explicit price exists). This is a SNAPSHOT using whatever rates are in
 * config/settings_data.json at the moment this runs — not a live
 * formula — so re-run this whenever those rates change.
 */

export const PRODUCT_ID_NUMERIC = "10522275741995"; // "test" product

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

const LOOSE_METALS = ["Silver", "Panchdhatu", "Copper", "22k Yellow Gold", "18K Yellow Gold", "14K Yellow Gold", "18K White Gold", "14K White Gold"];

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

function computeVariants(stonePrice) {
  const variants = [];
  const designValues = new Set(["N/A"]);

  for (const metal of LOOSE_METALS) {
    variants.push({ options: ["Loose", metal, "N/A"], price: stonePrice.toFixed(2) });
  }

  for (const [key, entries] of Object.entries(CATALOG)) {
    const [type, metal] = key.split("|");
    for (const entry of entries) {
      let settingCost;
      if (entry.price) {
        settingCost = entry.price;
      } else if (entry.weight) {
        const rate = RATES[metal] ?? 0;
        settingCost = entry.weight * (rate + MAKING_CHARGE_PER_GRAM);
      } else {
        continue;
      }
      const price = stonePrice + settingCost;
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

async function fetchStonePrice(admin, productGid) {
  const res = await admin.graphql(
    `#graphql
    query GetStonePrice($id: ID!) {
      product(id: $id) {
        variants(first: 250) {
          nodes { price selectedOptions { name value } }
        }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = await res.json();
  const nodes = json.data?.product?.variants?.nodes || [];
  const looseVariant = nodes.find((v) =>
    v.selectedOptions.some((o) => o.name === "Customised" && o.value === "Loose"),
  );
  if (!looseVariant) throw new Error("Could not find a Loose variant to read the stone's own price from");
  return parseFloat(looseVariant.price);
}

const CERT_UPGRADES = [
  { key: "GJI", price: 1000 },
  { key: "IGI", price: 1750 },
  { key: "GIA", price: 3500 },
];

/** Finds (or, on first use, creates) the shared "Certification Upgrade"
 * product — one real variant per paid upgrade (GJI/IGI/GIA), added to
 * cart as a second real line item only when a customer picks a paid
 * upgrade over their gemstone's free included certification. The free
 * cert never needs this — it's just a line-item property on the main
 * line, nothing to charge for. */
export async function getOrCreateCertProduct(admin) {
  const findRes = await admin.graphql(
    `#graphql
    query FindCertProduct($query: String!) {
      products(first: 1, query: $query) { nodes { id } }
    }`,
    { variables: { query: "handle:certification-upgrade" } },
  );
  const findJson = await findRes.json();
  const existing = findJson.data?.products?.nodes?.[0];
  if (existing) return existing.id;

  const createRes = await admin.graphql(
    `#graphql
    mutation CreateCertProduct($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title: "Certification Upgrade",
          handle: "certification-upgrade",
          status: "ACTIVE",
          vendor: "Internal",
          tags: ["internal-do-not-list"],
          productOptions: [{ name: "Lab", position: 1, values: CERT_UPGRADES.map((c) => ({ name: c.key })) }],
          variants: CERT_UPGRADES.map((c) => ({
            optionValues: [{ optionName: "Lab", name: c.key }],
            price: c.price.toFixed(2),
            inventoryPolicy: "CONTINUE",
            inventoryItem: { tracked: false },
          })),
        },
      },
    },
  );
  const createJson = await createRes.json();
  const errs = createJson.data?.productSet?.userErrors;
  if (errs?.length) throw new Error(`Creating cert product failed: ${JSON.stringify(errs)}`);
  const productId = createJson.data?.productSet?.product?.id;

  // Publish to Online Store explicitly — same reason as the old
  // synthetic-variant approach: an unpublished product's variants get
  // rejected by /cart/add.js. Non-fatal: this app's current scopes
  // (shopify.app.toml) don't include read_publications/write_publications
  // yet, so this throws until that's added and the merchant re-approves
  // scopes — but the product itself is already created at this point, so
  // don't let a missing scope block getting its variant IDs back. If
  // this fails, publish "Certification Upgrade" to Online Store manually
  // in Admin -> Products (one checkbox) until the scope lands.
  try {
    const pubRes = await admin.graphql(`#graphql
      query OnlineStorePublication { publications(first: 10) { nodes { id name } } }`);
    const pubJson = await pubRes.json();
    const onlineStore = pubJson.data?.publications?.nodes?.find((p) => p.name === "Online Store");
    if (onlineStore) {
      await admin.graphql(
        `#graphql
        mutation PublishToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        { variables: { id: productId, input: [{ publicationId: onlineStore.id }] } },
      );
    }
  } catch (err) {
    console.error("[getOrCreateCertProduct] publish step failed (non-fatal):", err);
  }
  return productId;
}

/** Returns { GJI: numericVariantId, IGI: ..., GIA: ... } for the theme
 * JS to embed directly — these are real, pre-existing, already-priced
 * variants, nothing created per-order. */
export async function getCertVariantIds(admin) {
  const productGid = await getOrCreateCertProduct(admin);
  const res = await admin.graphql(
    `#graphql
    query GetCertVariants($id: ID!) {
      product(id: $id) {
        variants(first: 10) { nodes { id selectedOptions { name value } } }
      }
    }`,
    { variables: { id: productGid } },
  );
  const json = await res.json();
  const nodes = json.data?.product?.variants?.nodes || [];
  const map = {};
  for (const v of nodes) {
    const lab = v.selectedOptions.find((o) => o.name === "Lab")?.value;
    if (lab) map[lab] = v.id.split("/").pop();
  }
  return map;
}

export async function repriceDesignVariants(admin) {
  const productGid = `gid://shopify/Product/${PRODUCT_ID_NUMERIC}`;
  const stonePrice = await fetchStonePrice(admin, productGid);
  const { variants, designValues } = computeVariants(stonePrice);

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
        userErrors { field message }
      }
    }`,
    { variables: { input } },
  );
  const json = await res.json();
  const userErrors = json.data?.productSet?.userErrors || [];
  if (userErrors.length) throw new Error(`productSet failed: ${JSON.stringify(userErrors)}`);

  return { stonePrice, variantCount: variants.length, designValueCount: designValues.length };
}
