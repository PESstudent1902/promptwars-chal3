/**
 * popup.js — EcoScore popup UI controller
 *
 * Handles:
 * - Loading and rendering score state
 * - Google sign-in / sign-out via background message
 * - History list rendering
 * - Share rank card generation (canvas-based)
 * - Location geocoding (OpenStreetMap reverse lookup)
 * - Toast notifications
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const loadingState  = $("loading-state");
const noKeyState    = $("no-key-state");
const signInState   = $("sign-in-state");
const scoreView     = $("score-view");

const scoreNumber   = $("score-number");
const ringFill      = $("ring-fill");
const tierBadge     = $("tier-badge");
const streakCount   = $("streak-count");
const statGreened   = $("stat-greened");
const statSaved     = $("stat-saved");
const statRank      = $("stat-rank");
const historyList   = $("history-list");
const historyEmpty  = $("history-empty");
const userRow       = $("user-row");
const userAvatar    = $("user-avatar");
const userName      = $("user-name");
const toast         = $("toast");

const locationBanner = $("location-banner");
const locationRow    = $("location-row");
const locationLabel  = $("location-label");
const enableLocBtn   = $("enable-location-btn");

// ─── State helpers ────────────────────────────────────────────────────────────

function showOnly(el) {
  [loadingState, noKeyState, signInState, scoreView].forEach((e) => {
    if (e === el) {
      e.removeAttribute("hidden");
    } else {
      e.setAttribute("hidden", "");
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  showOnly(loadingState);

  try {
    // Check API key
    const { gemini_api_key } = await chrome.storage.local.get(["gemini_api_key"]);
    if (!gemini_api_key) {
      showOnly(noKeyState);
      return;
    }

    // Load score state
    const [state, summary] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_SCORE_STATE" }),
      chrome.runtime.sendMessage({ type: "GET_MONTHLY_SUMMARY" }),
    ]);

    renderScore(state, summary);

    // Always go to score view directly — sign-in is optional, not a gate
    if (state.user) {
      renderUser(state.user);
    } else {
      // Hide user row but show score — sign-in is surfaced as an optional button
      if (userRow) userRow.setAttribute("hidden", "");
    }
    showOnly(scoreView);
    initLocation();

  } catch (err) {
    console.error("[EcoScore popup] Init error:", err);
    showOnly(noKeyState);
  }
}

// ─── Render score ─────────────────────────────────────────────────────────────

function renderScore(state, summary) {
  const score = state.total ?? 500;
  const streak = state.streak ?? 0;

  // Animate score number
  animateNumber(scoreNumber, 0, score, 600);

  // Ring fill: score 0–1000 mapped to 0–263.9 (circumference)
  const pct = Math.min(score / 1000, 1); // 1000 = full ring
  const dashOffset = 263.9 * (1 - pct);
  setTimeout(() => {
    if (ringFill) {
      ringFill.style.strokeDashoffset = dashOffset;
      // Color by score
      ringFill.style.stroke =
        score >= 800 ? "#1a9e6e" :
        score >= 650 ? "#25c98a" :
        score >= 500 ? "#e6a817" :
        score >= 350 ? "#e07b39" : "#c0392b";
    }
  }, 100);

  // Tier badge
  const tier = getTier(score);
  if (tierBadge) {
    tierBadge.textContent = `${tier.emoji} ${tier.label}`;
    tierBadge.style.background = tier.bg;
    tierBadge.style.color = tier.text;
  }

  // Streak
  if (streakCount) streakCount.textContent = streak;

  // Monthly stats
  if (statGreened) statGreened.textContent = summary?.greened ?? 0;
  if (statSaved) statSaved.textContent   = `${summary?.saved_kg ?? 0}`;
  if (statRank) statRank.textContent    = state.rank ? `#${state.rank}` : "—";

  // History
  renderHistory(state.history ?? []);
}

function renderUser(user) {
  if (userRow) userRow.removeAttribute("hidden");
  if (userAvatar) {
    if (user.picture) {
      userAvatar.src = user.picture;
      userAvatar.alt = user.name || "User avatar";
      userAvatar.removeAttribute("hidden");
    } else {
      userAvatar.setAttribute("hidden", "");
    }
  }
  if (userName) userName.textContent = user.name || user.email || "Signed in";
}

// ─── History list ─────────────────────────────────────────────────────────────

const CATEGORY_ICONS = {
  food:       "🍽️",
  cab:        "🚕",
  transport:  "🚇",
  ecommerce:  "📦",
  travel:     "✈️",
};

function renderHistory(history) {
  if (!historyList) return;
  historyList.innerHTML = "";

  if (!history || history.length === 0) {
    if (historyEmpty) historyEmpty.removeAttribute("hidden");
    return;
  }
  if (historyEmpty) historyEmpty.setAttribute("hidden", "");

  const recent = history.slice(0, 8);

  recent.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const icon = CATEGORY_ICONS[item.category] || "🌿";
    const deltaClass = item.delta > 0 ? "delta-pos" : item.delta < 0 ? "delta-neg" : "delta-zero";
    const deltaText  = item.delta > 0 ? `+${item.delta}` : item.delta < 0 ? `${item.delta}` : "0";
    const timeStr    = formatRelativeTime(item.timestamp);

    // Only textContent used — safe against XSS
    const iconEl = document.createElement("span");
    iconEl.className = "history-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;

    const bodyEl = document.createElement("div");
    bodyEl.className = "history-body";

    const labelEl = document.createElement("div");
    labelEl.className = "history-label";
    labelEl.textContent = item.label;
    labelEl.title = item.label;

    const metaEl = document.createElement("div");
    metaEl.className = "history-meta";
    metaEl.textContent = `${item.site} · ${timeStr}`;

    bodyEl.appendChild(labelEl);
    bodyEl.appendChild(metaEl);

    const deltaEl = document.createElement("span");
    deltaEl.className = `history-delta ${deltaClass}`;
    deltaEl.textContent = deltaText;
    deltaEl.setAttribute("aria-label", `${deltaText} credits`);

    li.appendChild(iconEl);
    li.appendChild(bodyEl);
    li.appendChild(deltaEl);
    li.setAttribute("aria-label", `${item.label}, ${deltaText} credits, ${timeStr}`);

    historyList.appendChild(li);
  });
}

// ─── Geolocation ──────────────────────────────────────────────────────────────

async function initLocation() {
  const { user_location } = await chrome.storage.local.get(["user_location"]);
  if (user_location?.city) {
    if (locationLabel) locationLabel.textContent = user_location.city;
    if (locationRow) locationRow.removeAttribute("hidden");
    if (locationBanner) locationBanner.setAttribute("hidden", "");
  } else {
    if (locationRow) locationRow.setAttribute("hidden", "");
    if (locationBanner) locationBanner.removeAttribute("hidden");
  }
}

// ─── Tier helper (mirrors score.js but works in popup context) ────────────────

function getTier(score) {
  if (score >= 800) return { label: "EcoChampion", emoji: "🌿", bg: "#e8f8f1", text: "#1a5c3e" };
  if (score >= 650) return { label: "GreenMover",  emoji: "🌱", bg: "#eef6f1", text: "#2d8a5e" };
  if (score >= 500) return { label: "Aware",        emoji: "🌾", bg: "#fdf7e4", text: "#a07800" };
  if (score >= 350) return { label: "Learning",     emoji: "🍂", bg: "#fdf0e6", text: "#a04a0a" };
  return               { label: "Starting Out", emoji: "🌫️", bg: "#fce8e6", text: "#8b1a10" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function animateNumber(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function formatRelativeTime(isoString) {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)   return "just now";
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return "";
  }
}

let toastTimer;
function showToast(message, duration = 2500) {
  if (!toast) return;
  toast.textContent = message;
  toast.removeAttribute("hidden");
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.setAttribute("hidden", ""), 200);
  }, duration);
}

// ─── Share rank card ──────────────────────────────────────────────────────────

async function generateShareCard() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_SCORE_STATE" });
    const score = state.total ?? 500;
    const tier  = getTier(score);
    const streak = state.streak ?? 0;

    const canvas = document.createElement("canvas");
    canvas.width  = 600;
    canvas.height = 315;
    const ctx = canvas.getContext("2d");

    // Background
    const grad = ctx.createLinearGradient(0, 0, 600, 315);
    grad.addColorStop(0, "#0d2b1f");
    grad.addColorStop(1, "#1a5c3e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 315);

    // Score
    ctx.fillStyle = "#25c98a";
    ctx.font = "bold 80px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(score, 60, 160);

    ctx.fillStyle = "#9ab8a6";
    ctx.font = "18px -apple-system, sans-serif";
    ctx.fillText("EcoScore", 60, 190);

    // Tier
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px -apple-system, sans-serif";
    ctx.fillText(`${tier.emoji} ${tier.label}`, 60, 240);

    // Streak
    ctx.fillStyle = "#e6a817";
    ctx.font = "bold 18px -apple-system, sans-serif";
    ctx.fillText(`🔥 ${streak} day streak`, 60, 275);

    // Brand
    ctx.fillStyle = "#4d7a5e";
    ctx.font = "bold 14px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("EcoScore · Carbon Awareness", 540, 295);

    // Convert to blob and copy
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showToast("📋 Rank card copied! Paste to share.");
      } catch {
        showToast("📊 Share: EcoScore " + score + " · " + tier.label);
      }
    });
  } catch (err) {
    showToast("Could not generate card.");
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

$("setup-btn")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("settings-btn")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("signin-btn")?.addEventListener("click", async () => {
  try {
    showToast("Signing in…");
    const result = await chrome.runtime.sendMessage({ type: "SIGN_IN" });
    if (result?.success) {
      showToast(`Welcome, ${result.user.name}! 🌿`);
      setTimeout(init, 800);
    }
  } catch (err) {
    showToast("Sign-in failed. Try again.");
  }
});

$("skip-signin-btn")?.addEventListener("click", () => {
  showOnly(scoreView);
  // Still boot score loading
  chrome.storage.local.get(["gemini_api_key"]).then(({ gemini_api_key }) => {
    if (gemini_api_key) {
      chrome.runtime.sendMessage({ type: "GET_SCORE_STATE" }).then((state) => {
        chrome.runtime.sendMessage({ type: "GET_MONTHLY_SUMMARY" }).then((summary) => {
          renderScore(state, summary);
          initLocation();
        });
      });
    }
  });
});

$("signout-btn")?.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  showToast("Signed out.");
  setTimeout(init, 600);
});

$("share-btn")?.addEventListener("click", generateShareCard);

enableLocBtn?.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      showToast("Open any website tab first, then enable location.");
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      func: () => new Promise((res) => {
        navigator.geolocation.getCurrentPosition(
          (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => res(null),
          { timeout: 8000 }
        );
      }),
    }, async (results) => {
      const coords = results?.[0]?.result;
      if (!coords) {
        showToast("Location access denied. Allow location in your browser.");
        return;
      }

      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json`);
        const d = await r.json();
        const city = d?.address?.city || d?.address?.town || d?.address?.suburb || "Your city";
        await chrome.storage.local.set({ user_location: { lat: coords.lat, lng: coords.lng, city } });
        if (locationLabel) locationLabel.textContent = city;
        if (locationRow) locationRow.removeAttribute("hidden");
        if (locationBanner) locationBanner.setAttribute("hidden", "");
        showToast(`📍 Location set to ${city}`);
      } catch {
        await chrome.storage.local.set({ user_location: { lat: coords.lat, lng: coords.lng, city: "Your city" } });
        showToast("📍 Location enabled!");
      }
    });
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
