/**
 * @module content-cab
 * @description Carbon awareness overlay for Ola, Uber, Rapido, BluSmart.
 *
 * Detects the selected ride type and distance, sends an ANALYZE_ACTION message
 * to the background service worker, and shows a comparison card banner.
 *
 * Security: uses Shadow DOM isolation, escaped text rendering, focus trap, and
 * cleanup on page unload. Plain IIFE required for MV3 content scripts.
 */
(function () {
  "use strict";

  const hostname = location.hostname;
  const SITE = hostname.includes("olacabs") ? "ola"
             : hostname.includes("uber") ? "uber"
             : hostname.includes("rapido") ? "rapido"
             : "blusmart";

  // ── Timing Constants ────────────────────────────────────────────────────────
  const DEBOUNCE_DELAY_MS = 1000;
  const INITIAL_DELAY_MS = 2500;

  // ── Site Labels Lookup ──────────────────────────────────────────────────────
  const SITE_LABELS = {
    ola: "Ola",
    uber: "Uber",
    rapido: "Rapido",
    blusmart: "BluSmart"
  };

  const SELECTORS = {
    ola:      { rideType: ["[data-testid='ride-category']","[class*='VehicleTitle']","[class*='CategoryName']","h3[class*='ride']"], distance: ["[data-testid='distance']","[class*='DistanceText']","[class*='tripDistance']"] },
    uber:     { rideType: ["[data-testid='option-title']","[class*='vehicle-type']","div[class*='ProductName']"], distance: ["[class*='trip-distance']","[class*='distanceText']"] },
    rapido:   { rideType: ["[class*='RideType']","[class*='category-name']","h4"], distance: ["[class*='distance']"] },
    blusmart: { rideType: ["[class*='vehicle']","[class*='carType']"], distance: ["[class*='distance']"] },
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

  function classifyRide(txt) {
    const l = (txt || "").toLowerCase();
    if (/share|pool|shared/.test(l)) return { type: "shared", isGreen: true, name: "Shared ride" };
    if (/electric|ev|blusmart/.test(l)) return { type: "ev", isGreen: true, name: "EV ride" };
    if (/bike|moto|scooter/.test(l)) return { type: "bike", isGreen: true, name: "Bike ride" };
    if (/auto/.test(l)) return { type: "auto", isGreen: false, name: "Auto rickshaw" };
    return { type: "solo", isGreen: false, name: "Solo cab" };
  }

  function parseDist(txt) {
    const m = (txt || "").match(/([\d.]+)\s*km/i);
    return m ? parseFloat(m[1]) : 5;
  }

  let lastKey = null;
  let active = false;
  /** @type {number|null} Debounce timer ID (local scope — no window pollution) */
  let debounceTimer = null;

  async function analyze() {
    if (active) return;
    active = true;
    const sel = SELECTORS[SITE] || SELECTORS.ola;
    const rideEl = queryFirst(sel.rideType);
    const distEl = queryFirst(sel.distance);
    const rideTxt = rideEl?.textContent?.trim() || "";
    if (!rideTxt) { active = false; return; }
    const dist = parseDist(distEl?.textContent?.trim() || "");
    const { type } = classifyRide(rideTxt);
    const key = `${type}_${dist}`;
    if (key === lastKey) { active = false; return; }
    lastKey = key;

    const siteLabel = SITE_LABELS[SITE] || "Cab";
    window.EcoScoreUI.showComingSoonBanner(siteLabel);
  }

  let lastURL = location.href;
  const cabObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(analyze, DEBOUNCE_DELAY_MS);
    if (location.href !== lastURL) {
      lastURL = location.href;
      lastKey = null;
      active = false;
    }
  });

  if (document.body) {
    cabObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Disconnect observer when page is unloaded to prevent memory leaks
  window.addEventListener("pagehide", () => cabObserver.disconnect(), { once: true });

  setTimeout(analyze, INITIAL_DELAY_MS);
})();
