/**
 * @module content-travel
 * @description Carbon awareness overlay for flight booking sites (MMT, Ixigo, Goibibo, Yatra).
 *
 * Detects flight origins/destinations, estimates distance, and displays comparison
 * cards encouraging rail alternatives where applicable.
 *
 * Security: Shadow DOM isolation, escaped text rendering, focus trap, and
 * cleanup on page unload. Plain IIFE required for MV3 content scripts.
 */
(function () {
  "use strict";
  const hostname = location.hostname;
  const SITE = hostname.includes("makemytrip") ? "makemytrip"
             : hostname.includes("ixigo") ? "ixigo"
             : hostname.includes("goibibo") ? "goibibo"
             : "yatra";

  // ── Timing Constants ────────────────────────────────────────────────────────
  const DEBOUNCE_DELAY_MS = 1200;
  const INITIAL_DELAY_MS = 2500;

  // ── Site Labels Lookup ──────────────────────────────────────────────────────
  const SITE_LABELS = {
    makemytrip: "MakeMyTrip",
    ixigo: "Ixigo",
    goibibo: "Goibibo",
    yatra: "Yatra"
  };

  const SELECTORS = {
    makemytrip: { origin: ["[data-cy='fromCity']","[class*='fromCity']",".hsw_inputBox .hsw_spanCity"], dest: ["[data-cy='toCity']","[class*='toCity']"] },
    ixigo:      { origin: ["span[class*='originCity']","[class*='city-name']:first-child"], dest: ["span[class*='destCity']"] },
    goibibo:    { origin: ["[data-testid='origin']","[class*='FromCity']"], dest: ["[data-testid='dest']","[class*='ToCity']"] },
    yatra:      { origin: ["[class*='OriginCity']","#Origin"], dest: ["[class*='DestCity']","#Destination"] },
  };

  function queryFirst(sels) {
    for (const s of sels) {
      try {
        const e = document.querySelector(s);
        if (e) return e;
      } catch {}
    }
    return null;
  }

  let lastKey = null;
  let active = false;
  /** @type {number|null} Local timer ID (prevents global window pollution) */
  let debounceTimer = null;

  async function analyze() {
    if (active) return;
    active = true;

    const sel = SELECTORS[SITE];
    if (!sel) { active = false; return; }

    const origin = queryFirst(sel.origin)?.textContent?.trim() || "";
    const dest   = queryFirst(sel.dest)?.textContent?.trim() || "";
    if (!origin || !dest) { active = false; return; }

    const key = `${origin}_${dest}`;
    if (key === lastKey) { active = false; return; }
    lastKey = key;

    const siteLabel = SITE_LABELS[SITE] || "Travel";
    window.EcoScoreUI.showComingSoonBanner(siteLabel);
  }

  if (/flight|air|fly/i.test(location.pathname + location.search)) {
    setTimeout(analyze, INITIAL_DELAY_MS);

    const travelObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(analyze, DEBOUNCE_DELAY_MS);
    });

    if (document.body) {
      travelObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("pagehide", () => travelObserver.disconnect(), { once: true });
  }
})();
