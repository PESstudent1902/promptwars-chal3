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
  const BANNER_ID = "ecoscore-root";

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

  function inferCategory(name) {
    const l = name.toLowerCase();
    if (/beef|mutton|lamb|goat/.test(l)) return "red meat";
    if (/chicken|prawn|fish|seafood|crab|egg/.test(l)) return "non-veg";
    if (/burger|pizza|fries|nugget|wrap/.test(l)) return "fast food";
    if (/dal|sabzi|roti|rice|idli|dosa|paneer|rajma/.test(l)) return "vegetarian";
    return "food";
  }

  // ── Banner injection (all rendering done here inline) ──────────────────────
  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function showBanner(result, label, onAccept, onDismiss) {
    removeBanner();
    const host = document.createElement("div");
    host.id = BANNER_ID;
    host.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;width:calc(100vw - 32px)";
    host.setAttribute("role", "alertdialog");
    host.setAttribute("aria-modal", "true");

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = buildCardHTML(result, label);
    document.body.appendChild(host);

    shadow.getElementById("btn-close").onclick   = () => { removeBanner(); escCleanup(); onDismiss("dismissed"); };
    shadow.getElementById("btn-proceed").onclick = () => { removeBanner(); escCleanup(); onDismiss("proceeded"); };
    shadow.getElementById("btn-switch").onclick  = () => { removeBanner(); escCleanup(); onAccept(); };

    // Escape listener cleanup/setup
    function escHandler(e) { if (e.key === "Escape") { removeBanner(); escCleanup(); onDismiss("keyboard"); } }
    function escCleanup() { document.removeEventListener("keydown", escHandler); }
    document.addEventListener("keydown", escHandler);

    // Focus Trap
    function focusTrap(e) {
      if (e.key === "Tab") {
        const focusables = [
          shadow.getElementById("btn-close"),
          shadow.getElementById("btn-switch"),
          shadow.getElementById("btn-proceed")
        ].filter(Boolean);
        const activeEl = shadow.activeElement;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (activeEl === first || !focusables.includes(activeEl)) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (activeEl === last || !focusables.includes(activeEl)) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    }
    shadow.addEventListener("keydown", focusTrap);

    setTimeout(() => shadow.getElementById("btn-switch")?.focus(), 350);
  }

  function showComingSoonBanner(siteName) {
    removeBanner();
    const host = document.createElement("div");
    host.id = BANNER_ID;
    host.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:420px;width:calc(100vw - 32px)";
    host.setAttribute("role", "alertdialog");
    host.setAttribute("aria-modal", "true");

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = window.buildComingSoonCardHTML(siteName);
    document.body.appendChild(host);

    const closeBanner = () => {
      removeBanner();
      bannerActive = false;
      document.removeEventListener("keydown", escHandler);
    };

    shadow.getElementById("btn-close").onclick   = closeBanner;
    shadow.getElementById("btn-proceed").onclick = closeBanner;

    function escHandler(e) { if (e.key === "Escape") { closeBanner(); } }
    document.addEventListener("keydown", escHandler);

    setTimeout(() => shadow.getElementById("btn-proceed")?.focus(), 350);
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

    showComingSoonBanner(SITE);
  }

  // ── Observe DOM ────────────────────────────────────────────────────────────
  const foodObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(analyze, 900);
  });

  if (document.body) {
    foodObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("pagehide", () => foodObserver.disconnect(), { once: true });

  setTimeout(analyze, 3000);
})();
