/**
 * @module background
 * @description MV3 Service Worker — central message router for EcoScore.
 *
 * Responsibilities:
 *  - Route content-script messages → Gemini API, score engine, identity
 *  - Debounce repeated analysis calls per item (45-second cooldown)
 *  - Fetch external HTML for eco-alternative discovery (allowlisted domains only)
 *  - Manage weekly notification digest via chrome.alarms
 *
 * Security hardening:
 *  - FETCH_HTML enforces an origin allowlist (SSRF prevention)
 *  - Message type validated against an explicit Set before routing
 *  - TTL-based eviction on the recentCalls map (prevents unbounded growth)
 *  - No User-Agent spoofing
 *
 * @typedef {Object} AnalyzePayload
 * @property {string} itemName - Product/item name (max 100 chars)
 * @property {string} category - One of: food | cab | ecommerce | travel
 * @property {number} quantity - Item quantity (default 1)
 * @property {Object} context  - Site-specific context data
 *
 * @typedef {Object} RecordPayload
 * @property {string} label       - Human-readable action label
 * @property {string} site        - Source site hostname
 * @property {number} creditDelta - EcoCredit change (clamped −60…+30)
 * @property {number} co2Kg       - CO₂ equivalent in kg
 * @property {string} analogy     - Gemini-generated analogy text
 * @property {string} category    - Action category
 */

import { analyzeCarbon } from "../utils/gemini.js";
import { recordAction, getScoreState, getMonthlySummary, saveUser } from "../utils/score.js";

// ─── Allowlisted origins for FETCH_HTML ──────────────────────────────────────
// Only these HTTPS origins may be fetched by the background worker.
// Prevents SSRF: a compromised content script cannot instruct the extension
// to fetch internal network addresses (localhost, RFC-1918 ranges, file://).

/** @type {ReadonlySet<string>} */
const ALLOWED_FETCH_HOSTNAMES = Object.freeze(new Set([
  "www.amazon.in",
  "amazon.in",
  "www.flipkart.com",
  "flipkart.com",
  "www.myntra.com",
  "myntra.com",
]));

/**
 * Validate that a URL is safe to fetch.
 * Enforces HTTPS-only and the hostname allowlist.
 *
 * @param {string} urlStr - Raw URL string from message payload
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateFetchUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") {
    return { ok: false, reason: "Missing or non-string URL" };
  }

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only HTTPS URLs are permitted" };
  }

  if (!ALLOWED_FETCH_HOSTNAMES.has(parsed.hostname)) {
    return { ok: false, reason: "Domain not in fetch allowlist" };
  }

  return { ok: true };
}

// ─── Message router ───────────────────────────────────────────────────────────

/** @type {ReadonlySet<string>} Valid message type identifiers */
const VALID_MSG_TYPES = Object.freeze(new Set([
  "ANALYZE_ACTION",
  "RECORD_ACTION",
  "GET_SCORE_STATE",
  "GET_MONTHLY_SUMMARY",
  "SIGN_IN",
  "SIGN_OUT",
  "FETCH_HTML",
  "DDGS_SEARCH",
]));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error("[EcoScore BG] Error:", err.message);
      sendResponse({ error: err.message });
    });
  return true; // keep channel open for async response
});

/**
 * Route an incoming message to the appropriate handler.
 * Validates the message type against VALID_MSG_TYPES to avoid unsafe routing.
 *
 * @param {Object} msg    - Message object from content script
 * @param {Object} sender - chrome.runtime.MessageSender
 * @returns {Promise<Object>} Handler result
 * @throws {Error} If message type is unknown or missing
 */
async function handleMessage(msg, sender) {
  if (!msg || !VALID_MSG_TYPES.has(msg.type)) {
    throw new Error("Invalid message type");
  }

  switch (msg.type) {
    case "ANALYZE_ACTION":      return await handleAnalyze(msg.payload);
    case "RECORD_ACTION":       return await handleRecord(msg.payload);
    case "GET_SCORE_STATE":     return await getScoreState();
    case "GET_MONTHLY_SUMMARY": return await getMonthlySummary();
    case "SIGN_IN":             return await handleSignIn();
    case "SIGN_OUT":            return await handleSignOut();
    case "FETCH_HTML":          return await handleFetchHtml(msg.payload?.url);
    case "DDGS_SEARCH":         return await handleDdgSearch(msg.payload?.query);
    default:                    throw new Error("Invalid message type");
  }
}

/**
 * Fetch HTML from an allowlisted e-commerce URL.
 * Validates origin against ALLOWED_FETCH_HOSTNAMES to prevent SSRF.
 *
 * @param {string} url - Target URL (must be HTTPS and on an allowed hostname)
 * @returns {Promise<string>} Raw HTML text (≤ 2 MB)
 * @throws {Error} If URL is invalid, not allowlisted, or the fetch fails
 */
async function handleFetchHtml(url) {
  const { ok, reason } = validateFetchUrl(url);
  if (!ok) {
    console.warn("[EcoScore BG] FETCH_HTML blocked:", reason);
    throw new Error("FETCH_BLOCKED");
  }

  const res = await fetch(url, {
    headers: { "Accept": "text/html,application/xhtml+xml" },
  });

  if (!res.ok) throw new Error("HTTP_" + res.status);
  return await res.text();
}

// ─── DuckDuckGo Instant Answer — free, no key ─────────────────────────────────

/**
 * Fetch a brief abstract / related topics from the DuckDuckGo Instant Answer API.
 * Completely free, no API key required.
 * Used to enrich Gemini prompt context with real-world product sustainability info.
 *
 * @param {string} query - Search query (product name + 'carbon footprint' or 'eco friendly')
 * @returns {Promise<{ abstract: string, relatedTopics: string[] }>}
 */
async function handleDdgSearch(query) {
  if (!query || typeof query !== "string") return { abstract: "", relatedTopics: [] };

  const safe = query.trim().slice(0, 120);
  const url  = `https://api.duckduckgo.com/?q=${encodeURIComponent(safe)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { abstract: "", relatedTopics: [] };

    const data = await res.json();
    const abstract = (data.AbstractText || "").slice(0, 300);
    const relatedTopics = (data.RelatedTopics || [])
      .filter(t => t.Text)
      .slice(0, 3)
      .map(t => t.Text.slice(0, 120));

    return { abstract, relatedTopics };
  } catch {
    return { abstract: "", relatedTopics: [] };
  }
}

// ─── Analyze — debounce per item ──────────────────────────────────────────────

/** @type {Map<string, number>} Maps item cache key → last-called timestamp */
const recentCalls = new Map();

/** Cooldown in ms before the same item can be re-analysed */
const ANALYZE_COOLDOWN_MS = 45_000;

/** Entries older than this are evicted from recentCalls (TTL-based cleanup) */
const RECENT_CALLS_TTL_MS = 120_000;

/**
 * Evict stale entries from recentCalls based on TTL.
 * Called after every insertion to bound memory usage without relying solely
 * on a size threshold.
 */
function evictStaleRecentCalls() {
  const cutoff = Date.now() - RECENT_CALLS_TTL_MS;
  for (const [k, ts] of recentCalls) {
    if (ts < cutoff) recentCalls.delete(k);
  }
}

/**
 * Handle an ANALYZE_ACTION message from a content script.
 * Debounces repeated calls for the same item to avoid API overuse.
 *
 * @param {AnalyzePayload} payload
 * @returns {Promise<Object>} Carbon analysis result, or { debounced: true }
 */
async function handleAnalyze(payload) {
  const key = `${payload.itemName}_${payload.category}`
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 80);

  const last = recentCalls.get(key);
  if (last && Date.now() - last < ANALYZE_COOLDOWN_MS) {
    return { debounced: true };
  }

  recentCalls.set(key, Date.now());
  evictStaleRecentCalls();

  return await analyzeCarbon(payload);
}

// ─── Record action + update badge ─────────────────────────────────────────────

/**
 * Record a user action and update the toolbar badge colour/text.
 *
 * @param {RecordPayload} payload
 * @returns {Promise<Object>} Updated score state
 */
async function handleRecord(payload) {
  const result = await recordAction(payload);

  const score = result.newTotal;
  const color = score >= 650 ? "#1a9e6e" : score >= 500 ? "#e6a817" : "#c0392b";
  chrome.action.setBadgeText({ text: String(score) });
  chrome.action.setBadgeBackgroundColor({ color });

  return result;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the signed-in Chrome profile and persist basic user info.
 * Uses Chrome Identity API — no OAuth token is requested or stored.
 *
 * @returns {Promise<{ success: boolean, user?: Object, reason?: string }>}
 */
async function handleSignIn() {
  return new Promise((resolve, reject) => {
    chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, async (info) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!info?.email) return resolve({ success: false, reason: "No Chrome profile signed in" });

      const name = info.email.split("@")[0].replace(/[._]/g, " ");
      const user = { name, email: info.email, picture: null };
      await saveUser(user);
      resolve({ success: true, user });
    });
  });
}

/**
 * Remove persisted user info from sync storage (sign-out).
 *
 * @returns {Promise<{ success: boolean }>}
 */
async function handleSignOut() {
  await chrome.storage.sync.remove("ecoscore_user");
  return { success: true };
}

// ─── Startup ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeText({ text: "500" });
  chrome.action.setBadgeBackgroundColor({ color: "#e6a817" });

  chrome.alarms.create("weeklyDigest", {
    periodInMinutes: 60 * 24 * 7,
    delayInMinutes: 60 * 24 * 7,
  });

  console.log("[EcoScore] Extension installed/updated v1.2.0.");
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("weeklyDigest", {
    periodInMinutes: 60 * 24 * 7,
    delayInMinutes: 60 * 24 * 7,
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "weeklyDigest") return;
  try {
    const [state, summary] = await Promise.all([getScoreState(), getMonthlySummary()]);
    const msg = summary.greened > 0
      ? `${summary.greened} green choices this month · ${summary.saved_kg} kg CO₂ saved. Keep it up!`
      : "Start making green swaps on Zomato, Ola and Amazon to earn EcoCredits!";

    chrome.notifications.create("digest", {
      type: "basic",
      iconUrl: "../../assets/icon128.png",
      title: `EcoScore: ${state.total} pts`,
      message: msg,
      priority: 1,
    });
  } catch (err) {
    console.warn("[EcoScore] Notification failed:", err.message);
  }
});

chrome.notifications.onClicked.addListener(() => {
  chrome.action.openPopup?.();
});
