/**
 * @module content-food
 * @description Carbon awareness overlay for Swiggy & Zomato food delivery.
 *
 * Detects items in the checkout cart, classifies their footprint, and offers eco-swaps.
 *
 * Security: Shadow DOM isolation, escaped text rendering, focus trap, and
 * cleanup on page unload. Plain IIFE required for MV3 content scripts.
 */
(function () {
  "use strict";

  const SITE = location.hostname.includes("zomato") ? "zomato" : "swiggy";

  // ── Timing Constants ────────────────────────────────────────────────────────
  const DEBOUNCE_DELAY_MS = 900;
  const INITIAL_DELAY_MS = 3000;

  // ── Selectors ──────────────────────────────────────────────────────────────
  const SELECTORS = {
    zomato: {
      cartItems: ["[data-testid='cart-item-name']", ".sc-gFqAkR", "[class*='ItemName']", "[class*='itemName']", "[class*='CartItem'] h4", "[class*='CartItemTitle']"],
    },
    swiggy: {
      cartItems: ["[data-testid='item-name']", "._3VT4J", "[class*='ItemTitle']", "[class*='itemName']", "[class*='cartItem'] p"],
    },
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let lastItem = null;
  let bannerActive = false;
  /** @type {number|null} Local timer ID (prevents global window pollution) */
  let debounceTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function queryFirst(sels, root = document) {
    for (const s of sels) {
      try { const el = root.querySelector(s); if (el) return el; } catch {}
    }
    return null;
  }

  // queryAll is used to check multiple selectors
  function queryAll(sels, root = document) {
    for (const s of sels) {
      try {
        const els = root.querySelectorAll(s);
        if (els.length > 0) return [...els];
      } catch {}
    }
    return [];
  }

  function getCartItems() {
    const sels = SELECTORS[SITE]?.cartItems || [];
    const els = queryAll(sels);
    const names = [...new Set(
      els.map(e => e.textContent?.trim()).filter(t => t && t.length > 1 && t.length < 150)
    )];
    return names;
  }

  // ── Analyze ────────────────────────────────────────────────────────────────
  async function analyze() {
    if (bannerActive) return;
    bannerActive = true;

    const items = getCartItems();
    if (!items.length) { bannerActive = false; return; }

    const priority = items.find(i => /beef|mutton|lamb|chicken|prawn/i.test(i)) || items[items.length - 1];
    if (priority === lastItem) { bannerActive = false; return; }
    lastItem = priority;

    window.EcoScoreUI.showComingSoonBanner(SITE);
  }

  // ── Observe DOM ────────────────────────────────────────────────────────────
  const foodObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(analyze, DEBOUNCE_DELAY_MS);
  });

  if (document.body) {
    foodObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("pagehide", () => foodObserver.disconnect(), { once: true });

  setTimeout(analyze, INITIAL_DELAY_MS);
})();
