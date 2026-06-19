/**
 * @module co2-data
 * @description Local CO2 reference database for common product categories.
 * Used to:
 *  1. Add a ground-truth "hint" to the Gemini prompt (reduces hallucination)
 *  2. Validate / clamp Gemini's co2_kg if it deviates wildly (>5x)
 *  3. Drive the static fallback when the API is offline
 *
 * Sources: ADEME, Our World in Data, Carbon Trust, Indian lifecycle studies.
 */

/**
 * CO2 reference entries keyed by a short product type label.
 * Each entry: { co2_kg: number, severity: string, unit: string }
 *   co2_kg  — median lifecycle CO2e per unit
 *   severity — low | medium | high | critical
 *   unit    — human-readable unit for the co2_kg value
 */
export const CO2_DB = Object.freeze({
  // ── Electronics ───────────────────────────────────────────────────────────
  "laptop":              { co2_kg: 350,  severity: "critical", unit: "per device" },
  "refurbished laptop":  { co2_kg: 70,   severity: "medium",   unit: "per device" },
  "desktop pc":          { co2_kg: 500,  severity: "critical", unit: "per device" },
  "smartphone":          { co2_kg: 80,   severity: "high",     unit: "per device" },
  "refurbished phone":   { co2_kg: 16,   severity: "medium",   unit: "per device" },
  "tablet":              { co2_kg: 100,  severity: "high",     unit: "per device" },
  "smartwatch":          { co2_kg: 30,   severity: "medium",   unit: "per device" },
  "earbuds":             { co2_kg: 12,   severity: "medium",   unit: "per pair" },
  "headphones":          { co2_kg: 20,   severity: "medium",   unit: "per device" },
  "speaker":             { co2_kg: 15,   severity: "medium",   unit: "per device" },
  "television":          { co2_kg: 400,  severity: "critical", unit: "per device" },
  "refrigerator":        { co2_kg: 600,  severity: "critical", unit: "per appliance" },
  "air conditioner":     { co2_kg: 800,  severity: "critical", unit: "per appliance" },
  "washing machine":     { co2_kg: 300,  severity: "critical", unit: "per appliance" },
  "microwave":           { co2_kg: 80,   severity: "high",     unit: "per appliance" },
  "electric kettle":     { co2_kg: 20,   severity: "medium",   unit: "per appliance" },

  // ── Clothing & Textiles ───────────────────────────────────────────────────
  "polyester shirt":     { co2_kg: 10,   severity: "medium",   unit: "per garment" },
  "cotton shirt":        { co2_kg: 5,    severity: "low",      unit: "per garment" },
  "organic cotton shirt":{ co2_kg: 2.5,  severity: "low",      unit: "per garment" },
  "jeans":               { co2_kg: 33,   severity: "high",     unit: "per pair" },
  "synthetic jacket":    { co2_kg: 22,   severity: "high",     unit: "per garment" },
  "sneakers synthetic":  { co2_kg: 14,   severity: "medium",   unit: "per pair" },
  "canvas sneakers":     { co2_kg: 5,    severity: "low",      unit: "per pair" },
  "leather shoes":       { co2_kg: 18,   severity: "high",     unit: "per pair" },
  "polyester mat":       { co2_kg: 8,    severity: "medium",   unit: "per mat" },
  "jute mat":            { co2_kg: 2.5,  severity: "low",      unit: "per mat" },

  // ── Food & Drink ──────────────────────────────────────────────────────────
  "beef":                { co2_kg: 27,   severity: "critical", unit: "per kg" },
  "lamb":                { co2_kg: 24,   severity: "critical", unit: "per kg" },
  "chicken":             { co2_kg: 6.9,  severity: "high",     unit: "per kg" },
  "fish":                { co2_kg: 5,    severity: "medium",   unit: "per kg" },
  "paneer":              { co2_kg: 3,    severity: "low",      unit: "per kg" },
  "dal":                 { co2_kg: 0.9,  severity: "low",      unit: "per kg" },
  "rice":                { co2_kg: 2.5,  severity: "low",      unit: "per kg" },
  "milk":                { co2_kg: 3.2,  severity: "medium",   unit: "per litre" },

  // ── Transport ─────────────────────────────────────────────────────────────
  "petrol cab":          { co2_kg: 0.17, severity: "medium",   unit: "per km" },
  "ev cab":              { co2_kg: 0.05, severity: "low",      unit: "per km" },
  "metro":               { co2_kg: 0.03, severity: "low",      unit: "per km" },
  "bus":                 { co2_kg: 0.06, severity: "low",      unit: "per km" },
  "domestic flight":     { co2_kg: 0.15, severity: "high",     unit: "per km per person" },
  "train":               { co2_kg: 0.04, severity: "low",      unit: "per km" },

  // ── Home & Lifestyle ──────────────────────────────────────────────────────
  "plastic bottle":      { co2_kg: 0.2,  severity: "low",      unit: "per bottle" },
  "steel bottle":        { co2_kg: 3.5,  severity: "low",      unit: "per bottle (lifetime)" },
  "plastic bags":        { co2_kg: 2,    severity: "medium",   unit: "per 100 bags" },
  "furniture":           { co2_kg: 60,   severity: "high",     unit: "per piece" },
  "mattress":            { co2_kg: 100,  severity: "high",     unit: "per mattress" },
  "plastic toy":         { co2_kg: 6,    severity: "medium",   unit: "per item" },
  "wooden toy":          { co2_kg: 1.2,  severity: "low",      unit: "per item" },
  "detergent chemical":  { co2_kg: 2.5,  severity: "medium",   unit: "per 1L" },
  "natural detergent":   { co2_kg: 0.8,  severity: "low",      unit: "per 1L" },
  "plastic planters":    { co2_kg: 5,    severity: "medium",   unit: "per set" },
  "coir pots":           { co2_kg: 1,    severity: "low",      unit: "per set" },
});

// ── Keyword → DB key mapping ─────────────────────────────────────────────────

const KEYWORD_MAP = [
  // Specific laptop/phone first to avoid generic shadowing
  [/\b(refurbished|renewed).*(laptop|macbook|computer)\b/i,             "refurbished laptop"],
  [/\b(refurbished|renewed).*(phone|iphone|android|samsung)\b/i,        "refurbished phone"],

  [/\b(macbook|laptop|laptops|computer|computers|notebook)\b/i,         "laptop"],
  [/\b(desktop|gaming pc|imac)\b/i,                                     "desktop pc"],
  [/\b(iphone|samsung galaxy|pixel|oneplus|smartphone|android phone)\b/i,"smartphone"],
  [/\b(tablet|ipad)\b/i,                                                "tablet"],
  [/\b(smartwatch|fitness band)\b/i,                                    "smartwatch"],
  [/\b(earbuds|airpods|tws)\b/i,                                        "earbuds"],
  [/\b(headphone|headphones|headset)\b/i,                               "headphones"],
  [/\b(bluetooth speaker|smart speaker)\b/i,                            "speaker"],
  [/\b(television|tv|smart tv)\b/i,                                     "television"],
  [/\b(fridge|refrigerator)\b/i,                                        "refrigerator"],
  [/\b(air conditioner|ac unit|split ac)\b/i,                           "air conditioner"],
  [/\b(washing machine)\b/i,                                            "washing machine"],
  [/\b(microwave)\b/i,                                                  "microwave"],

  // Specific clothing first
  [/\b(polyester|nylon|synthetic).*(shirt|tshirt|t-shirt|kurta|dress)\b/i,"polyester shirt"],
  [/\b(organic|khadi).*(shirt|tshirt|t-shirt|kurta|dress)\b/i,         "organic cotton shirt"],
  [/\b(shirt|tshirt|t-shirt|kurta|dress|blouse)\b/i,                   "cotton shirt"],
  [/\b(jeans|denim trousers|denim pants)\b/i,                          "jeans"],

  // Specific mats first
  [/\b(jute|coir).*(mat|rug|doormat)\b/i,                              "jute mat"],
  [/\b(mat|rug|doormat|carpet)\b/i,                                     "polyester mat"],

  // Specific footwear first
  [/\b(leather|pu leather).*(shoe|boot|sandal|footwear)\b/i,           "leather shoes"],
  [/\b(canvas|sustainable).*(sneaker|shoe)\b/i,                        "canvas sneakers"],
  [/\b(sneaker|shoe|boot|sandal|footwear)\b/i,                         "sneakers synthetic"],

  [/\b(chicken|poultry)\b/i,                                           "chicken"],
  [/\b(mutton|lamb|goat meat)\b/i,                                     "lamb"],
  [/\b(beef|steak|burger)\b/i,                                         "beef"],
  [/\b(fish|prawn|seafood|salmon)\b/i,                                 "fish"],
  [/\b(paneer|cottage cheese)\b/i,                                     "paneer"],
  [/\b(dal|lentil|rajma|chana)\b/i,                                    "dal"],
  [/\b(plastic bottle|water bottle.*plastic)\b/i,                      "plastic bottle"],
  [/\b(steel bottle|stainless.*bottle|insulated bottle)\b/i,           "steel bottle"],
  [/\b(plastic bag|polythene bag|garbage bag)\b/i,                     "plastic bags"],
  [/\b(sofa|mattress|wardrobe|furniture)\b/i,                          "furniture"],
  [/\b(mattress)\b/i,                                                  "mattress"],

  // Specific toys first
  [/\b(wooden toy|eco toy|wood.*toy)\b/i,                              "wooden toy"],
  [/\b(toy|doll|puzzle|plastic toy)\b/i,                               "plastic toy"],

  // Specific detergents first
  [/\b(natural|organic|plant.based).*(detergent|dishwash|cleaner)\b/i, "natural detergent"],
  [/\b(detergent|dishwash|cleaner|soap)\b/i,                           "detergent chemical"],

  // Specific planters first
  [/\b(coir pot|coco coir|biodegradable pot)\b/i,                      "coir pots"],
  [/\b(planter|plant pot|flower pot)\b/i,                              "plastic planters"],
];

/**
 * Look up verified CO2 data for a product name.
 *
 * @param {string} productName - Raw product name/title
 * @returns {{ co2_kg: number, severity: string, unit: string, key: string } | null}
 */
export function lookupCO2(productName) {
  const name = (productName || "").toLowerCase();
  for (const [regex, key] of KEYWORD_MAP) {
    if (regex.test(name)) {
      const entry = CO2_DB[key];
      return entry ? { ...entry, key } : null;
    }
  }
  return null;
}

/**
 * Validate that a Gemini-returned co2_kg is within a plausible range.
 * Returns the (possibly clamped) value and a boolean indicating if it was clamped.
 *
 * @param {number} geminiCo2   - The co2_kg value from Gemini
 * @param {string} productName - Product name for lookup
 * @returns {{ co2_kg: number, clamped: boolean }}
 */
export function validateCO2(geminiCo2, productName) {
  const ref = lookupCO2(productName);
  if (!ref) return { co2_kg: geminiCo2, clamped: false };

  const lo = ref.co2_kg / 5;
  const hi = ref.co2_kg * 5;

  if (geminiCo2 < lo || geminiCo2 > hi) {
    return { co2_kg: ref.co2_kg, clamped: true };
  }
  return { co2_kg: geminiCo2, clamped: false };
}

/** Sustainable product keywords — used for "Great Choice" detection */
const SUSTAINABLE_KEYWORDS = /\b(jute|coir|bamboo|organic|reclaimed|refurbished|renewed|recycled|biodegradable|compostable|sustainable|eco-friendly|ecofriendly|fair-trade|fairtrade|khadi|handloom|natural fiber|hemp|linen|cork)\b/i;

/**
 * Returns true if the product name indicates it is already a sustainable choice.
 * @param {string} productName
 * @returns {boolean}
 */
export function isSustainableProduct(productName) {
  return SUSTAINABLE_KEYWORDS.test(productName || "");
}
