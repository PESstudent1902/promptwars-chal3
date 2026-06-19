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
  const SITE = hostname.includes("olacabs") ? "ola" : hostname.includes("uber") ? "uber" : hostname.includes("rapido") ? "rapido" : "blusmart";
  const BANNER_ID = "ecoscore-root";

  const SELECTORS = {
    ola:      { rideType: ["[data-testid='ride-category']","[class*='VehicleTitle']","[class*='CategoryName']","h3[class*='ride']"], distance: ["[data-testid='distance']","[class*='DistanceText']","[class*='tripDistance']"] },
    uber:     { rideType: ["[data-testid='option-title']","[class*='vehicle-type']","div[class*='ProductName']"], distance: ["[class*='trip-distance']","[class*='distanceText']"] },
    rapido:   { rideType: ["[class*='RideType']","[class*='category-name']","h4"], distance: ["[class*='distance']"] },
    blusmart: { rideType: ["[class*='vehicle']","[class*='carType']"], distance: ["[class*='distance']"] },
  };

  function q(sels) { for (const s of sels) { try { const e = document.querySelector(s); if (e) return e; } catch {} } return null; }

  function classifyRide(txt) {
    const l = (txt || "").toLowerCase();
    if (/share|pool|shared/.test(l)) return { type:"shared", isGreen:true, name:"Shared ride" };
    if (/electric|ev|blusmart/.test(l)) return { type:"ev", isGreen:true, name:"EV ride" };
    if (/bike|moto|scooter/.test(l)) return { type:"bike", isGreen:true, name:"Bike ride" };
    if (/auto/.test(l)) return { type:"auto", isGreen:false, name:"Auto rickshaw" };
    return { type:"solo", isGreen:false, name:"Solo cab" };
  }

  function parseDist(txt) { const m = (txt||"").match(/([\d.]+)\s*km/i); return m ? parseFloat(m[1]) : 5; }

  let lastKey = null, active = false;
  /** @type {number|null} Debounce timer ID (local scope — no window pollution) */
  let debounceTimer = null;

  function removeBanner() { document.getElementById(BANNER_ID)?.remove(); }

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

    // Store listener ref so it can be removed in ALL dismiss paths (not just Escape)
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
      active = false;
      document.removeEventListener("keydown", escHandler);
    };

    shadow.getElementById("btn-close").onclick   = closeBanner;
    shadow.getElementById("btn-proceed").onclick = closeBanner;

    function escHandler(e) { if (e.key === "Escape") { closeBanner(); } }
    document.addEventListener("keydown", escHandler);

    setTimeout(() => shadow.getElementById("btn-proceed")?.focus(), 350);
  }

  async function analyze() {
    if (active) return;
    active = true;
    const sel = SELECTORS[SITE] || SELECTORS.ola;
    const rideEl = q(sel.rideType), distEl = q(sel.distance);
    const rideTxt = rideEl?.textContent?.trim() || "";
    if (!rideTxt) { active = false; return; }
    const dist = parseDist(distEl?.textContent?.trim() || "");
    const { type } = classifyRide(rideTxt);
    const key = `${type}_${dist}`;
    if (key === lastKey) { active = false; return; }
    lastKey = key;

    showComingSoonBanner(SITE === "ola" ? "Ola" : SITE === "uber" ? "Uber" : SITE === "rapido" ? "Rapido" : "BluSmart");
  }

  let lastURL = location.href;
  const cabObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(analyze, 1000);
    if (location.href !== lastURL) { lastURL = location.href; lastKey = null; active = false; }
  });

  if (document.body) {
    cabObserver.observe(document.body, { childList:true, subtree:true });
  }

  // Disconnect observer when page is unloaded to prevent memory leaks
  window.addEventListener("pagehide", () => cabObserver.disconnect(), { once: true });

  setTimeout(analyze, 2500);
})();
