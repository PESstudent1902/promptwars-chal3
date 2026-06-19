/**
 * @module score
 * @description EcoScore credit system — tier ladder, action recording, and monthly summaries.
 *
 * Storage layout:
 *  - chrome.storage.sync  — total score, streak, user profile, last action date, rank
 *    (synced across devices; subject to 100KB quota)
 *  - chrome.storage.local — action history (up to MAX_HISTORY entries)
 *    (local device only; 10MB quota avoids QUOTA_BYTES_PER_ITEM errors)
 *
 * ES module — imported only by background.js (MV3 service worker, which supports modules).
 */

/** @type {Readonly<Object>} Storage key constants — frozen to prevent accidental mutation */
const KEYS = Object.freeze({
  SCORE:    "ecoscore_total",
  STREAK:   "ecoscore_streak",
  LAST_DAY: "ecoscore_last_action_date",
  SNAPSHOT: "ecoscore_monthly_snapshot",
  RANK:     "ecoscore_rank",
  USER:     "ecoscore_user",
  // NOTE: HISTORY is stored in chrome.storage.LOCAL (not sync) to avoid
  // QUOTA_BYTES_PER_ITEM (8KB) errors as history grows.
  HISTORY:  "ecoscore_history",
});

/** Maximum number of history entries retained in local storage */
const MAX_HISTORY = 50;

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read the current score state from chrome.storage.sync + local.
 *
 * Score, streak, user, rank and snapshot are stored in sync storage for
 * cross-device availability. History is stored in local storage to avoid
 * the 8KB per-item sync quota limit.
 *
 * @returns {Promise<Object>} Combined score state object
 */
export async function getScoreState() {
  const [syncData, localData] = await Promise.all([
    new Promise((resolve) => {
      const syncKeys = [KEYS.SCORE, KEYS.STREAK, KEYS.LAST_DAY, KEYS.SNAPSHOT, KEYS.RANK, KEYS.USER];
      chrome.storage.sync.get(syncKeys, resolve);
    }),
    new Promise((resolve) => {
      chrome.storage.local.get([KEYS.HISTORY], resolve);
    }),
  ]);

  return {
    total:           syncData[KEYS.SCORE]    ?? 500,
    history:         localData[KEYS.HISTORY] ?? [],
    streak:          syncData[KEYS.STREAK]   ?? 0,
    lastActionDate:  syncData[KEYS.LAST_DAY] ?? null,
    monthlySnapshot: syncData[KEYS.SNAPSHOT] ?? null,
    rank:            syncData[KEYS.RANK]     ?? null,
    user:            syncData[KEYS.USER]     ?? null,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Record a user action: update the score, history, and streak.
 *
 * Score and streak are written to sync storage (cross-device).
 * History is written to local storage (larger quota, device-only).
 *
 * @param {Object} params
 * @param {string} params.label       - Human-readable action label (truncated to 100 chars)
 * @param {string} params.site        - Source site name (truncated to 50 chars)
 * @param {number} params.creditDelta - Credit change; clamped to [-60, +30]
 * @param {number} params.co2Kg       - CO₂ equivalent in kg
 * @param {string} params.analogy     - Gemini analogy text (truncated to 300 chars)
 * @param {string} params.category    - Action category (food | cab | ecommerce | travel)
 * @returns {Promise<{ newTotal: number, streak: number, delta: number, entry: Object }>}
 */
export async function recordAction({ label, site, creditDelta, co2Kg, analogy, category }) {
  const state = await getScoreState();
  const delta = Math.max(-60, Math.min(30, Math.round(Number(creditDelta) || 0)));
  const newTotal = clampScore(state.total, delta);

  const entry = {
    id:        Date.now(),
    label:     String(label    || "").slice(0, 100),
    site:      String(site     || "").slice(0, 50),
    delta,
    co2Kg:     Number(co2Kg)   || 0,
    analogy:   String(analogy  || "").slice(0, 300),
    category:  String(category || "").slice(0, 30),
    timestamp: new Date().toISOString(),
  };

  const history = trimHistory([entry, ...state.history], MAX_HISTORY);

  // Streak logic — only green actions (positive delta) advance the streak
  const today     = new Date().toDateString();
  const streak = updateStreak(state.streak, state.lastActionDate, delta);

  try {
    // Write score/streak to sync (cross-device)
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({
        [KEYS.SCORE]:    newTotal,
        [KEYS.STREAK]:   streak,
        [KEYS.LAST_DAY]: delta > 0 ? today : state.lastActionDate,
      }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

    // Write history to local (larger quota, avoids QUOTA_BYTES_PER_ITEM errors)
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [KEYS.HISTORY]: history }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  } catch (err) {
    // Storage quota exceeded or write failure — log but don't crash
    console.warn("[EcoScore] Storage write failed:", err.message);
  }

  return { newTotal, streak, delta, entry };
}

// ─── User ─────────────────────────────────────────────────────────────────────

/**
 * Persist basic user profile information to sync storage.
 *
 * @param {{ name: string, email: string, picture: string|null }} userInfo
 * @returns {Promise<void>}
 */
export async function saveUser(userInfo) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      [KEYS.USER]: {
        name:    String(userInfo.name    || "").slice(0, 100),
        email:   String(userInfo.email   || "").slice(0, 200),
        picture: String(userInfo.picture || "").slice(0, 500),
      },
    }, resolve);
  });
}

// ─── Monthly summary ──────────────────────────────────────────────────────────

/**
 * Compute a summary of the current month's actions from the history.
 *
 * @returns {Promise<{ greened: number, saved_kg: number, topCategory: string, totalActions: number }>}
 */
export async function getMonthlySummary() {
  const state = await getScoreState();
  return getMonthlySummaryFromHistory(state.history);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a numeric score to a tier label, emoji, and colour.
 *
 * @param {number} score - Current EcoScore total
 * @returns {{ label: string, emoji: string, color: string }}
 */
export function getTier(score) {
  if (score >= 800) return { label: "EcoChampion", emoji: "🌿", color: "#1a9e6e" };
  if (score >= 650) return { label: "GreenMover",  emoji: "🌱", color: "#2d8a5e" };
  if (score >= 500) return { label: "Aware",        emoji: "🌾", color: "#e6a817" };
  if (score >= 350) return { label: "Learning",     emoji: "🍂", color: "#e07b39" };
  return               { label: "Starting Out",  emoji: "🌫️", color: "#c0392b" };
}

export function getDeltaMessage(delta) {
  if (delta >= 20) return "Huge green win! 🌿";
  if (delta >= 10) return "Nice choice for the planet.";
  if (delta >= 1)  return "Every bit counts.";
  if (delta === 0) return "Noted. No change.";
  if (delta >= -10) return "Small carbon cost.";
  if (delta >= -30) return "High impact choice.";
  return "Heavy carbon footprint.";
}

export function clampScore(total, delta) {
  return Math.max(0, Math.min(9999, total + delta));
}

export function trimHistory(history, max = 50) {
  return history.slice(0, max);
}

export function updateStreak(currentStreak, lastActionDate, delta) {
  if (delta <= 0) return currentStreak;
  const today = new Date().toDateString();
  if (lastActionDate === today) return currentStreak;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  return lastActionDate === yesterday ? currentStreak + 1 : 1;
}

export function getMonthlySummaryFromHistory(history) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const monthActions = (history || []).filter(
    (h) => new Date(h.timestamp).getTime() >= start
  );

  const greened  = monthActions.filter((h) => h.delta > 0).length;
  const saved_kg = monthActions
    .filter((h) => h.delta > 0)
    .reduce((s, h) => s + (h.co2Kg || 0), 0);

  const counts = {};
  for (const h of monthActions) counts[h.category] = (counts[h.category] || 0) + 1;
  const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  return {
    greened,
    saved_kg:    Math.round(saved_kg * 10) / 10,
    topCategory,
    totalActions: monthActions.length,
  };
}
