/**
 * @module gemini
 * @description Gemini API integration with full fallback chain.
 *
 * Fallback chain: Cache → Gemini 3.5 Flash → Gemini 3.1 Flash-Lite → Static fallback
 *
 * Content scripts cannot import this directly (MV3 content scripts don't support ES modules).
 * background.js imports it and proxies results via chrome.runtime.sendMessage.
 *
 * Security notes:
 *  - API key is sent via the x-goog-api-key HTTP header (not as a URL query param)
 *  - All user-supplied strings are sanitized before being included in prompts
 *  - Gemini responses are capped at MAX_RESPONSE_BYTES before parsing
 *  - The parsed response severity is validated against a strict enum
 */

import { lookupCO2, validateCO2, isSustainableProduct } from "./co2-data.js";

/** @type {readonly string[]} Gemini endpoint URLs tried in order */
const ENDPOINTS = Object.freeze([
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
]);

/** Cache TTL: results are reused for 24 hours before re-querying the API */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum Gemini response size accepted before parsing */
const MAX_RESPONSE_BYTES = 12_288; // 12 KB

/** Fetch timeout — prevents popup hanging indefinitely */
const FETCH_TIMEOUT_MS = 15_000;

/** Valid severity values */
const VALID_SEVERITIES = Object.freeze(new Set(["low", "medium", "high", "critical"]));

/** Maximum output tokens for Gemini API */
const MAX_OUTPUT_TOKENS = 1024;

/** Retry delay for 429 status codes in milliseconds */
const RETRY_DELAY_MS = 6000;

/** Maximum length for cache keys */
const MAX_CACHE_KEY_LENGTH = 120;

/** Required fields in Gemini response */
const REQUIRED_FIELDS = Object.freeze([
  "co2_kg", "severity", "analogy", "credit_delta",
  "current_pros", "current_cons", "alternative_name", "alternative_co2_kg",
  "alternative_pros", "alternative_cons", "saving_kg", "saving_message",
]);

// ─── Storage helpers ──────────────────────────────────────────────────────────

/**
 * Gets API key from storage
 * @returns {Promise<string|null>}
 */
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["gemini_api_key"], (r) => resolve(r.gemini_api_key || null));
  });
}

/**
 * Gets cached data if valid
 * @param {string} key Cache key
 * @returns {Promise<Object|null>}
 */
async function getCached(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`ec_${key}`], (r) => {
      const e = r[`ec_${key}`];
      if (!e || Date.now() - e.ts > CACHE_TTL_MS) return resolve(null);
      resolve(e.data);
    });
  });
}

/**
 * Sets cache data
 * @param {string} key Cache key
 * @param {Object} data Data to cache
 * @returns {Promise<void>}
 */
async function setCache(key, data) {
  chrome.storage.local.set({ [`ec_${key}`]: { data, ts: Date.now() } });
}

// ─── Sanitize & Validate ──────────────────────────────────────────────────────

/**
 * Sanitizes input string
 * @param {string} str Input string
 * @returns {string} Sanitized string
 */
export function sanitize(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[\x00-\x1F\x7F<>"'`]/g, "").trim().slice(0, 200);
}

/**
 * Validate API key format. Accepts any Google AI Studio key starting with AIza.
 * Relaxed to support newer longer key formats.
 * @param {string} key
 * @returns {boolean}
 */
export function isValidApiKeyFormat(key) {
  if (typeof key !== "string") return false;
  // Match AIza followed by 20-60 alphanumeric/dash/underscore characters
  return /^AIza[a-zA-Z0-9\-_]{20,60}$/.test(key);
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Builds the prompt for Gemini API
 * @param {Object} input
 * @param {string} input.itemName
 * @param {string} input.category
 * @param {number} [input.quantity=1]
 * @param {Object} [input.context={}]
 * @returns {string}
 */
function buildPrompt({ itemName, category, quantity = 1, context = {} }) {
  const item      = sanitize(itemName);
  const cat       = sanitize(category);
  const subCat    = sanitize(context.ecoCategory || "");
  const city      = sanitize(context.userCity || "India");
  const altName   = sanitize(context.alternativeName || "");
  const altUrl    = sanitize(context.alternativeUrl || "");
  const altDetails = sanitize(context.alternativeDetails || "");

  const verb = cat === "food" ? "order" : cat === "cab" ? "book" : cat === "travel" ? "book" : "purchase";

  // Get local CO2 reference data for this product
  const localRef = lookupCO2(item);
  const alreadySustainable = isSustainableProduct(item);

  let prompt = `You are a carbon footprint expert for Indian consumers.\n`;
  prompt += `A user in ${city} is about to ${verb} "${item}".\n`;
  prompt += `Product category: ${cat}${subCat ? ` (sub-type: ${subCat})` : ""}. Quantity: ${quantity}.\n\n`;

  prompt += buildPromptHints(item, localRef, alreadySustainable, altName, altUrl, altDetails);
  prompt += buildPromptRules();

  return prompt;
}

/**
 * Builds hints and reference data for the prompt
 * @param {string} item Sanitized item name
 * @param {Object} localRef Local DB reference data
 * @param {boolean} alreadySustainable Whether product is already eco-friendly
 * @param {string} altName Alternative product name
 * @param {string} altUrl Alternative product URL
 * @param {string} altDetails Alternative product details
 * @returns {string} Prompt string section
 */
function buildPromptHints(item, localRef, alreadySustainable, altName, altUrl, altDetails) {
  let hints = "";
  if (localRef) {
    hints += `REFERENCE DATA: Verified lifecycle CO2 for this type of product is approximately ${localRef.co2_kg} kg CO2e (${localRef.unit}). Use this as your anchor — do not deviate more than 5x without strong justification.\n\n`;
  }

  if (alreadySustainable) {
    hints += `NOTE: This product IS ALREADY an eco-friendly/sustainable choice (it uses sustainable materials/processes). `;
    hints += `Set "is_sustainable_choice": true. Set "alternative_name" to "" (empty string). `;
    hints += `Set "alternative_co2_kg" to 0, "saving_kg" to 0. `;
    hints += `Give "credit_delta" a POSITIVE value (reward for good choice). `;
    hints += `In "saving_message" celebrate their excellent sustainable choice — do NOT suggest switching.\n\n`;
  }

  if (altName) {
    hints += `We found a specific greener alternative on the same store: "${altName}" (URL: ${altUrl}). Details: ${altDetails}.\n`;
    hints += `Compare these two exact products. The alternative_name MUST be "${altName}".\n\n`;
  }
  return hints;
}

/**
 * Builds rules and output format instructions for the prompt
 * @returns {string} Prompt string section
 */
function buildPromptRules() {
  return `CRITICAL RULES:
1. The alternative product MUST serve the SAME PURPOSE and be the SAME TYPE of product as the original. Do NOT suggest a lifestyle change (e.g., "cook at home") as an alternative to a physical product. Do NOT suggest a completely different category.
   - If original is a laptop → alternative must be a laptop (e.g., refurbished version)
   - If original is a t-shirt → alternative must be a t-shirt (e.g., organic cotton)
   - If original is a plastic bottle → alternative must be a bottle (e.g., steel/glass bottle)
   - If original is beef → alternative must be a protein dish (e.g., paneer, dal — NOT "go vegan")
2. Be specific and concrete. Name real brands or product types, not vague suggestions.
3. The analogy must be relatable to Indian daily life — not technical jargon.

Return ONLY a JSON object with this exact structure — no markdown, no prose, just raw JSON:
{
  "is_sustainable_choice": <true if the product is already eco-friendly, false otherwise>,
  "co2_kg": <realistic number — kg CO2 equivalent for this item/action>,
  "severity": <"low" | "medium" | "high" | "critical">,
  "analogy": "<ONE punchy sentence comparing carbon cost to something in Indian daily life. Example: 'That is like running a ceiling fan for 3 days straight.' Be specific and emotional.>",
  "credit_delta": <integer -60 to +30. Negative = carbon cost, positive = carbon saving>,
  "current_pros": ["<pro 1>", "<pro 2>"],
  "current_cons": ["<con 1 — carbon/environment downside>", "<con 2>"],
  "alternative_name": "<SAME-CATEGORY greener product name — e.g. 'Refurbished MacBook Air M1' not 'use library books'. Empty string if product is already sustainable.>",
  "alternative_co2_kg": <number — CO2 for the alternative, 0 if already sustainable>,
  "alternative_pros": ["<pro 1 of the alternative>", "<pro 2>"],
  "alternative_cons": ["<con 1 of the alternative — honest, e.g. costs more>"],
  "saving_kg": <number — kg CO2 saved by switching, 0 if already sustainable>,
  "saving_message": "<one short sentence — celebrate if sustainable, or state savings if switching>"
}

CO2 reference: beef/lamb 20-27 kg/kg, chicken 6 kg/kg, paneer 3 kg/kg, dal 0.9 kg/kg, petrol cab 0.17 kg/km, EV cab 0.05 kg/km, metro 0.03 kg/km, flight 0.15 kg/km, smartphone ~70-90 kg, laptop ~300-400 kg, organic cotton tshirt 2.5 kg, polyester tshirt 10 kg, new laptop 350 kg vs refurbished 70 kg. Return ONLY the JSON object.`;
}

// ─── Static fallback ──────────────────────────────────────────────────────────

/**
 * Deterministic offline fallback. Uses the CO2 local DB where possible,
 * then falls back to curated static entries.
 * @param {string} itemName Item name
 * @param {string} category Category name
 * @returns {Object} Fallback result
 */
function staticFallback(itemName, category) {
  const item = (itemName || "").toLowerCase();

  if (category === "food") return foodFallback(item);
  if (category === "cab") return cabFallback(item);
  if (category === "travel") return travelFallback(item);
  if (category === "ecommerce") return ecommerceFallback(item);

  return smartGenericFallback(item);
}

/**
 * Static fallback for food category
 * @param {string} item Item name
 * @returns {Object}
 */
function foodFallback(item) {
  if (/chicken|mutton|beef|lamb|prawn|fish/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 6.0, severity: "high", analogy: "Ordering this every week for a year produces as much CO₂ as driving ~3,000 km.", credit_delta: -18, current_pros: ["High protein", "Tastes great"], current_cons: ["~6 kg CO₂ per serving", "High water usage"], alternative_name: "Paneer Tikka or Dal Makhani", alternative_co2_kg: 1.2, alternative_pros: ["80% less carbon", "More affordable"], alternative_cons: ["Different taste profile"], saving_kg: 4.8, saving_message: "Switching to paneer saves 4.8 kg CO₂ — like skipping a 28 km car ride!" };
  }
  return { is_sustainable_choice: false, co2_kg: 1.5, severity: "low", analogy: "This meal has a modest carbon footprint — about the same as a 9 km auto ride.", credit_delta: -5, current_pros: ["Reasonable carbon footprint", "Satisfying meal"], current_cons: ["Packaging adds ~0.3 kg CO₂", "Delivery vehicle emissions"], alternative_name: "Home-cooked version of the same meal", alternative_co2_kg: 0.3, alternative_pros: ["5× less carbon", "Healthier, cheaper"], alternative_cons: ["Takes more time to prepare"], saving_kg: 1.2, saving_message: "Cooking at home saves 1.2 kg CO₂ and money!" };
}

/**
 * Static fallback for cab category
 * @param {string} item Item name
 * @returns {Object}
 */
function cabFallback(item) {
  if (/shared|share|pool/.test(item)) {
    return { is_sustainable_choice: true, co2_kg: 0.5, severity: "low", analogy: "Shared ride is one of the greenest cab options — only 0.5 kg CO₂.", credit_delta: 15, current_pros: ["Shares emissions", "Affordable"], current_cons: ["Slightly longer journey"], alternative_name: "", alternative_co2_kg: 0, alternative_pros: [], alternative_cons: [], saving_kg: 0, saving_message: "Great choice! Shared rides are already much greener than solo cabs." };
  }
  return { is_sustainable_choice: false, co2_kg: 1.7, severity: "medium", analogy: "This solo cab ride produces as much CO₂ as charging your phone 200 times.", credit_delta: -12, current_pros: ["Door-to-door convenience", "Air conditioned"], current_cons: ["~1.7 kg CO₂", "Adds to traffic"], alternative_name: "Ola Share or Metro", alternative_co2_kg: 0.3, alternative_pros: ["Saves 1.4 kg CO₂", "Often faster in traffic"], alternative_cons: ["Less private"], saving_kg: 1.4, saving_message: "Switching to shared saves 1.4 kg CO₂ — equivalent to planting a sapling!" };
}

/**
 * Static fallback for travel category
 * @param {string} item Item name
 * @returns {Object}
 */
function travelFallback(item) {
  return { is_sustainable_choice: false, co2_kg: 150, severity: "critical", analogy: "This flight produces more CO₂ than an average Indian emits in an entire month.", credit_delta: -60, current_pros: ["Fast — saves hours", "Comfortable"], current_cons: ["~150 kg CO₂ per passenger", "10× more than train"], alternative_name: "Rajdhani / Shatabdi Train", alternative_co2_kg: 15, alternative_pros: ["90% less carbon", "Scenic, comfortable", "City-centre to city-centre"], alternative_cons: ["Takes longer (but you can sleep/work)"], saving_kg: 135, saving_message: "Taking the train saves 135 kg CO₂ — your single biggest climate action!" };
}

/**
 * Static fallback for ecommerce category
 * @param {string} item Item name
 * @returns {Object}
 */
function ecommerceFallback(item) {
  if (isSustainableProduct(item)) {
    return { is_sustainable_choice: true, co2_kg: 1.5, severity: "low", analogy: "This product is made from sustainable materials with a minimal carbon footprint.", credit_delta: 15, current_pros: ["Eco-friendly sustainable material", "Low manufacturing emissions"], current_cons: ["May cost slightly more"], alternative_name: "", alternative_co2_kg: 0, alternative_pros: [], alternative_cons: [], saving_kg: 0, saving_message: "Awesome! You're already buying the eco-friendly option. 🏆" };
  }
  if (/\b(laptop|macbook|computer)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 350, severity: "critical", analogy: "Manufacturing this laptop emits more CO₂ than driving 1,800 km in a petrol car.", credit_delta: -45, current_pros: ["Brand new warranty", "Maximum battery capacity"], current_cons: ["High manufacturing footprint", "Depletes rare metals"], alternative_name: "Refurbished MacBook Air M1", alternative_co2_kg: 70, alternative_pros: ["80% lower manufacturing emissions", "Includes warranty"], alternative_cons: ["May have minor cosmetic wear"], saving_kg: 280, saving_message: "Choosing refurbished saves 280 kg CO₂ — like planting 12 trees!" };
  }
  if (/\b(phone|smartphone|iphone|android)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 80, severity: "high", analogy: "Manufacturing this smartphone uses more carbon than a refrigerator running for a full year.", credit_delta: -30, current_pros: ["Latest features", "Flawless battery"], current_cons: ["Massive mining impact", "Contributes to e-waste"], alternative_name: "Refurbished iPhone 13 (128GB)", alternative_co2_kg: 16, alternative_pros: ["Saves 64 kg CO₂", "Tested like-new, lower cost"], alternative_cons: ["Battery health ~85%"], saving_kg: 64, saving_message: "Choosing refurbished saves 64 kg CO₂ — a massive climate win!" };
  }
  if (/\b(shoes?|sneakers?|footwear|sandals?|boots?)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 12, severity: "medium", analogy: "Producing synthetic sneakers releases carbon equivalent to burning 5 litres of petrol.", credit_delta: -15, current_pros: ["Brand popularity", "Standard synthetic build"], current_cons: ["Oil-based plastics", "Non-biodegradable"], alternative_name: "Neemans ReLive Sneakers (recycled plastic)", alternative_co2_kg: 4.2, alternative_pros: ["Made from recycled bottles", "Washable & comfortable"], alternative_cons: ["Requires gentle care"], saving_kg: 7.8, saving_message: "Neemans recycled sneakers save 7.8 kg CO₂!" };
  }
  if (/\b(t-shirt|tshirt|shirt|kurta|dress|clothing|wear|apparel)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 9, severity: "medium", analogy: "Making this synthetic garment uses as much water as a person drinks in 3 years.", credit_delta: -12, current_pros: ["Low initial price", "Stretchy fit"], current_cons: ["Fossil-fuel derived polyester", "Microplastics in every wash"], alternative_name: "No Nasties Organic Cotton T-Shirt", alternative_co2_kg: 3, alternative_pros: ["100% certified organic", "Fair trade, carbon neutral"], alternative_cons: ["Wash in cold water to avoid shrinking"], saving_kg: 6, saving_message: "No Nasties organic shirt saves 6 kg CO₂ and stops microplastic pollution!" };
  }
  if (/\b(bottle|flask|tumbler)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 1.5, severity: "low", analogy: "A plastic bottle takes 450 years to decompose — outlasting civilizations.", credit_delta: -5, current_pros: ["Lightweight", "Very cheap"], current_cons: ["Leaches microplastics", "Contributes to ocean pollution"], alternative_name: "Milton Thermosteel Insulated Bottle", alternative_co2_kg: 0.4, alternative_pros: ["Food-grade 18/8 stainless steel", "Hot/cold 24 hours"], alternative_cons: ["Slightly heavier to carry"], saving_kg: 1.1, saving_message: "Milton steel bottle saves 1.1 kg CO₂ and eliminates plastic waste!" };
  }
  if (/\b(mat|rug|doormat|carpet)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 8, severity: "medium", analogy: "This synthetic mat releases microplastics every time it rains, polluting groundwater.", credit_delta: -10, current_pros: ["Low price", "Easy to wash"], current_cons: ["Synthetic polyester", "Microplastics, non-biodegradable"], alternative_name: "Onlymat Natural Jute Door Mat", alternative_co2_kg: 2.8, alternative_pros: ["100% natural biodegradable jute", "Handwoven, durable"], alternative_cons: ["Dry clean or brush clean only"], saving_kg: 5.2, saving_message: "Onlymat Jute Mat saves 5.2 kg CO₂ and eliminates plastic footprint!" };
  }
  if (/\b(bag|backpack|garbage|trash bin)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 2, severity: "medium", analogy: "These plastic bags stay in our ecosystem for 400+ years, harming wildlife.", credit_delta: -8, current_pros: ["Extremely cheap", "Waterproof"], current_cons: ["Virgin petroleum plastic", "Harmful chemical leaching"], alternative_name: "Beco Compostable Garbage Bags (corn starch)", alternative_co2_kg: 0.5, alternative_pros: ["Decomposes in 180 days", "Zero microplastics"], alternative_cons: ["Not for sharp objects or hot liquids"], saving_kg: 1.5, saving_message: "Beco compostable bags save 1.5 kg CO₂ and leave zero microplastics!" };
  }
  if (/\b(furniture|sofa|mattress|wardrobe|table|chair|desk|bed)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 60, severity: "high", analogy: "Manufacturing this furniture emits carbon equivalent to driving 300 km in a petrol car.", credit_delta: -22, current_pros: ["Sturdy construction", "Convenient size"], current_cons: ["Virgin wood or high-footprint metal", "Heavy shipping emissions"], alternative_name: "Reclaimed Wood Furniture (same type)", alternative_co2_kg: 18, alternative_pros: ["100% recycled/reclaimed wood", "Saves forest timber"], alternative_cons: ["Natural texture variations"], saving_kg: 42, saving_message: "Choosing reclaimed wood saves 42 kg CO₂ and protects forests!" };
  }
  if (/\b(detergent|dishwash|shampoo|bodywash|handwash|cleaner|soap)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 2.5, severity: "medium", analogy: "Chemical detergents contain phosphates that cause toxic algal blooms in Indian lakes.", credit_delta: -10, current_pros: ["Strong synthetic foam", "Scented fragrances"], current_cons: ["Synthetic toxins", "Plastic container waste"], alternative_name: "Beco Natural Plant-Based Dishwash Liquid", alternative_co2_kg: 0.8, alternative_pros: ["Plant-based, baby-safe", "Coconut extract base"], alternative_cons: ["Slightly less lather than synthetic"], saving_kg: 1.7, saving_message: "Beco natural dishwash saves 1.7 kg CO₂ and keeps lakes clean!" };
  }
  if (/\b(toy|doll|puzzle|game)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 6, severity: "medium", analogy: "Plastic toys take centuries to degrade — they will outlast your grandchildren.", credit_delta: -10, current_pros: ["Colorful and cheap", "Waterproof"], current_cons: ["Toxic plastics", "Non-recyclable"], alternative_name: "Shumee Wooden Eco Toy (same play type)", alternative_co2_kg: 1.2, alternative_pros: ["Natural wood", "Non-toxic child-safe paints"], alternative_cons: ["Heavier than plastic"], saving_kg: 4.8, saving_message: "Shumee wooden toys save 4.8 kg CO₂ and are completely safe!" };
  }
  if (/\b(pot|planter|garden|plant|seeds)\b/.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 5, severity: "medium", analogy: "Plastic plant pots are made from oil — every pot is a tiny fossil fuel investment.", credit_delta: -8, current_pros: ["Lightweight", "Very cheap"], current_cons: ["Virgin petroleum plastic", "Non-biodegradable"], alternative_name: "Beco Biodegradable Coir Pots", alternative_co2_kg: 1, alternative_pros: ["100% organic coconut coir", "Biodegradable, enriches soil"], alternative_cons: ["Fragile over multiple seasons"], saving_kg: 4, saving_message: "Beco coir pots save 4.0 kg CO₂ and eliminate plastic waste!" };
  }
  // ── LED / lighting — already the greenest choice ────────────────────────
  if (/\b(led|cfl|energy.sav|night.?lamp|bulb|tube.?light|downlight|spotlight|strip.?light|fairy.?light|desk.?lamp|floor.?lamp|table.?lamp|reading.?lamp|smart.?light|tubelight)\b/i.test(item)) {
    return { is_sustainable_choice: true, co2_kg: 2.0, severity: "low", analogy: "An LED bulb uses 80% less electricity than an incandescent — one of the easiest wins for the planet.", credit_delta: 10, current_pros: ["LED is already the most energy-efficient lighting tech", "Lasts 15,000–25,000 hours"], current_cons: ["Contains small amounts of electronics that need responsible disposal"], alternative_name: "", alternative_co2_kg: 0, alternative_pros: [], alternative_cons: [], saving_kg: 0, saving_message: "Great choice! LED lighting is already the eco-friendly standard. 🏆" };
  }
  // ── Small appliances ────────────────────────────────────────────────────
  if (/\b(fan|ceiling.fan|table.fan|pedestal.fan|exhaust.fan)\b/i.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 18, severity: "medium", analogy: "Manufacturing this fan emits as much CO₂ as running it on electricity for 2 years.", credit_delta: -12, current_pros: ["Affordable cooling", "Low running cost"], current_cons: ["Non-recyclable plastic parts", "Manufacturing emissions"], alternative_name: "BLDC Ceiling Fan (same brand/size)", alternative_co2_kg: 18, alternative_pros: ["Uses 65% less electricity than standard fans", "Saves ~1,200 kWh over lifetime"], alternative_cons: ["Higher upfront cost"], saving_kg: 12, saving_message: "A BLDC fan saves electricity equivalent to 12 kg CO₂ over its lifetime!" };
  }
  if (/\b(charger|cable|usb|power.bank|adapter|extension.cord|power.strip)\b/i.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 3, severity: "low", analogy: "Electronics accessories have a small but real footprint from plastic and copper mining.", credit_delta: -5, current_pros: ["Essential accessory", "Widely compatible"], current_cons: ["Short product lifespan", "Hard to recycle mixed materials"], alternative_name: "GaN Fast Charger (same wattage, smaller, lasts longer)", alternative_co2_kg: 2, alternative_pros: ["50% smaller, lasts 2× longer", "GaN tech runs cooler — less heat damage"], alternative_cons: ["Slightly higher price"], saving_kg: 1, saving_message: "A quality GaN charger lasts longer and saves 1 kg CO₂ over repeated replacements!" };
  }
  if (/\b(watch|clock|alarm)\b/i.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 8, severity: "medium", analogy: "Manufacturing this watch uses rare metals mined with significant environmental impact.", credit_delta: -8, current_pros: ["Reliable timekeeping", "Stylish accessory"], current_cons: ["Rare metal mining", "Battery creates e-waste"], alternative_name: "Solar-Powered Watch (same style)", alternative_co2_kg: 3, alternative_pros: ["No battery replacements ever", "Charges from any light source"], alternative_cons: ["Needs occasional light exposure to charge"], saving_kg: 5, saving_message: "A solar watch eliminates battery waste and saves 5 kg CO₂!" };
  }
  if (/\b(pen|pencil|notebook|diary|stationery|paper)\b/i.test(item)) {
    return { is_sustainable_choice: false, co2_kg: 1, severity: "low", analogy: "Paper stationery has a modest footprint, but recycled alternatives cut it by 60%.", credit_delta: -3, current_pros: ["Affordable", "Widely available"], current_cons: ["Virgin wood pulp", "Bleaching uses chemicals"], alternative_name: "Recycled Paper Notebook (same size)", alternative_co2_kg: 0.4, alternative_pros: ["100% recycled paper", "No new trees cut"], alternative_cons: ["Slightly off-white pages"], saving_kg: 0.6, saving_message: "Recycled notebooks save 0.6 kg CO₂ and protect forests!" };
  }
  return smartGenericFallback(item);
}

/**
 * Extracts the core product noun from the item name and returns a specific,
 * relevant alternative. Never returns 'Eco-friendly version of the same product'.
 * @param {string} item Item name
 * @returns {Object} Fallback result
 */
function smartGenericFallback(item) {
  // Strip common noise words to find the core product noun
  const cleaned = item
    .replace(/\b(pack of \d+|set of \d+|\d+\s*(w|watt|watts|v|volt|kg|g|ml|l|inch|cm|mm|ft|gb|tb|mah|rpm|db|pcs?|pieces?))\b/gi, "")
    .replace(/\b(pigeon|prestige|bajaj|philips|bosch|havells|usha|kent|eureka|orient|crompton|anchor|syska|wipro|hoard|eveready|wipro|surya|panasonic|lg|samsung|whirlpool|godrej|voltas|daikin|hitachi|carrier|blue star)\b/gi, "")
    .replace(/\b(plastic|polyester|nylon|synthetic|melamine|acrylic|pvc|abs|polypropylene)\b/gi, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Extract the last meaningful noun (1–2 words)
  const words = cleaned.split(" ").filter(w => w.length > 2);
  const noun = words.length >= 2
    ? words.slice(-2).join(" ")
    : words[0] || "product";

  const title = noun.replace(/\b\w/g, c => c.toUpperCase());

  // Check for plastic/synthetic material signals → suggest sustainable material swap
  if (/\b(plastic|polyester|nylon|synthetic|pvc|acrylic|melamine)\b/i.test(item)) {
    return {
      is_sustainable_choice: false,
      co2_kg: 4.0, severity: "medium",
      analogy: `Plastic and synthetic ${title.toLowerCase()} manufacturing releases greenhouse gases and creates persistent waste.`,
      credit_delta: -8,
      current_pros: ["Affordable", "Widely available"],
      current_cons: ["Non-biodegradable plastic", "Microplastic pollution risk"],
      alternative_name: `Bamboo or Stainless Steel ${title}`,
      alternative_co2_kg: 1.0,
      alternative_pros: ["Natural or fully recyclable material", "Lasts significantly longer"],
      alternative_cons: ["Slightly higher upfront cost"],
      saving_kg: 3.0,
      saving_message: `Switching to a sustainable ${title.toLowerCase()} saves ~3 kg CO₂ and eliminates plastic waste!`
    };
  }

  // Default: generic but product-named response
  return {
    is_sustainable_choice: false,
    co2_kg: 4.0, severity: "medium",
    analogy: `Manufacturing and shipping a ${title.toLowerCase()} to your door generates carbon roughly equal to charging 500 smartphones.`,
    credit_delta: -8,
    current_pros: ["Convenient home delivery", "Meets your immediate need"],
    current_cons: ["Manufacturing emissions", "Packaging and last-mile delivery waste"],
    alternative_name: `Second-hand or Refurbished ${title}`,
    alternative_co2_kg: 1.0,
    alternative_pros: ["Avoids new manufacturing emissions", "Often significantly cheaper"],
    alternative_cons: ["May require more research to source locally"],
    saving_kg: 3.0,
    saving_message: `Choosing a refurbished or second-hand ${title.toLowerCase()} saves ~3 kg CO₂!`
  };
}

// ─── Main API call ────────────────────────────────────────────────────────────

/**
 * Call a Gemini endpoint with timeout protection.
 * @param {string} prompt
 * @param {string} apiKey
 * @param {string} endpointUrl
 * @returns {Promise<string>}
 * @throws {Error} INVALID_API_KEY | HTTP_xxx | RATE_LIMIT_EXHAUSTED | TIMEOUT
 */
async function callGemini(prompt, apiKey, endpointUrl) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") throw new Error("TIMEOUT");
      throw err;
    }
    clearTimeout(timeout);

    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * RETRY_DELAY_MS));
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 400 && (txt.includes("API_KEY_INVALID") || txt.includes("invalid"))) {
        throw new Error("INVALID_API_KEY");
      }
      throw new Error(`HTTP_${res.status}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return raw.length > MAX_RESPONSE_BYTES ? raw.slice(0, MAX_RESPONSE_BYTES) : raw;
  }

  throw new Error("RATE_LIMIT_EXHAUSTED");
}

/**
 * Parse and validate raw Gemini response text.
 * @param {string} raw
 * @returns {Object} Validated carbon analysis result
 */
export function parseGeminiResponse(raw) {
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("NO_JSON_IN_RESPONSE");
  text = text.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON_PARSE_FAILED: ${e.message}`);
  }

  for (const f of REQUIRED_FIELDS) {
    if (parsed[f] === undefined) throw new Error(`MISSING_FIELD:${f}`);
  }

  if (!VALID_SEVERITIES.has(parsed.severity)) parsed.severity = "medium";

  // Enforce is_sustainable_choice boolean
  parsed.is_sustainable_choice = !!parsed.is_sustainable_choice;

  // If Gemini says sustainable, clear alternative fields
  if (parsed.is_sustainable_choice) {
    parsed.alternative_name    = "";
    parsed.alternative_co2_kg  = 0;
    parsed.saving_kg           = 0;
    parsed.credit_delta        = Math.max(0, Math.round(Number(parsed.credit_delta) || 10));
  } else {
    parsed.credit_delta = Math.max(-60, Math.min(30, Math.round(Number(parsed.credit_delta) || 0)));
  }

  parsed.alternative_co2_kg = Math.max(0, Number(parsed.alternative_co2_kg) || 0);
  parsed.saving_kg          = Math.max(0, Number(parsed.saving_kg) || 0);
  parsed.co2_kg             = Math.max(0, Number(parsed.co2_kg) || 0);

  // Coerce arrays
  if (!Array.isArray(parsed.current_pros))     parsed.current_pros = [String(parsed.current_pros)];
  if (!Array.isArray(parsed.current_cons))     parsed.current_cons = [String(parsed.current_cons)];
  if (!Array.isArray(parsed.alternative_pros)) parsed.alternative_pros = [String(parsed.alternative_pros)];
  if (!Array.isArray(parsed.alternative_cons)) parsed.alternative_cons = [String(parsed.alternative_cons)];

  return parsed;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyse the carbon footprint of a user action.
 *
 * Fallback chain:
 *  1. Chrome storage cache (24h TTL)
 *  2. Gemini 2.5 Flash
 *  3. Gemini 1.5 Flash
 *  4. Static fallback (offline, deterministic)
 *
 * @param {Object} input
 * @param {string} input.itemName
 * @param {string} input.category
 * @param {number} [input.quantity=1]
 * @param {Object} [input.context={}]
 * @returns {Promise<Object>}
 */
export async function analyzeCarbon(input) {
  const cacheKey = buildCacheKey(input.itemName, input.category);

  // 1. Cache hit
  const cached = await getCached(cacheKey);
  if (cached) return { ...cached, fromCache: true, usedFallback: false };

  // 2. Validate API key
  const apiKey = await getApiKey();
  if (!apiKey || !isValidApiKeyFormat(apiKey)) {
    if (apiKey) console.warn("[EcoScore] API key format invalid — using static fallback");
    else        console.warn("[EcoScore] No API key — using static fallback");
    return { ...staticFallback(input.itemName, input.category), fromCache: false, usedFallback: true };
  }

  // 3. Try Gemini endpoints
  const prompt = buildPrompt(input);
  let lastError = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const raw    = await callGemini(prompt, apiKey, endpoint);
      let result   = parseGeminiResponse(raw);

      // Hybrid validation: cross-check co2_kg against local DB
      const { co2_kg: validated, clamped } = validateCO2(result.co2_kg, input.itemName);
      if (clamped) {
        console.info("[EcoScore] CO2 value clamped from", result.co2_kg, "→", validated, "(local DB reference)");
        result.co2_kg = validated;
        // Recalculate saving_kg if clamped
        if (!result.is_sustainable_choice && result.alternative_co2_kg > 0) {
          result.saving_kg = Math.max(0, parseFloat((result.co2_kg - result.alternative_co2_kg).toFixed(2)));
        }
      }

      const final = { ...result, fromCache: false, usedFallback: false };
      await setCache(cacheKey, final);
      return final;
    } catch (err) {
      console.warn(`[EcoScore] Gemini endpoint failed (${endpoint}):`, err.message);
      lastError = err;
      if (err.message === "INVALID_API_KEY") break;
    }
  }

  // 4. Static fallback
  console.warn("[EcoScore] All Gemini endpoints failed, using static fallback. Last error:", lastError?.message);
  return { ...staticFallback(input.itemName, input.category), fromCache: false, usedFallback: true };
}

/**
 * Sanitizes string for prompt inclusion
 * @param {string} str Input string
 * @returns {string} Sanitized string
 */
export function sanitizeForPrompt(str) {
  return sanitize(str);
}

/**
 * Clamps credit delta to valid range
 * @param {number} delta Input delta
 * @returns {number} Clamped delta
 */
export function clampCreditDelta(delta) {
  return Math.max(-60, Math.min(30, Math.round(Number(delta) || 0)));
}

/**
 * Validates a parsed carbon result
 * @param {Object} result Parsed result
 * @returns {boolean} True if valid
 */
export function validateCarbonResult(result) {
  for (const field of REQUIRED_FIELDS) {
    if (result[field] === undefined) throw new Error(`Missing field: ${field}`);
  }
  return true;
}

/**
 * Parses carbon response from raw text
 * @param {string} rawText Raw text
 * @returns {Object} Parsed response
 */
export function parseCarbonResponse(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Builds a valid cache key
 * @param {string} itemName Item name
 * @param {string} category Category name
 * @returns {string} Cache key
 */
export function buildCacheKey(itemName, category) {
  const rawKey = `${category}_${itemName}`;
  return sanitize(rawKey).toLowerCase().replace(/\s+/g, "_").slice(0, MAX_CACHE_KEY_LENGTH);
}
