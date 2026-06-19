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
  const SITE = hostname.includes("makemytrip") ? "makemytrip" : hostname.includes("ixigo") ? "ixigo" : hostname.includes("goibibo") ? "goibibo" : "yatra";
  const BANNER_ID = "ecoscore-root";

  const SELECTORS = {
    makemytrip: { origin: ["[data-cy='fromCity']","[class*='fromCity']",".hsw_inputBox .hsw_spanCity"], dest: ["[data-cy='toCity']","[class*='toCity']"] },
    ixigo:      { origin: ["span[class*='originCity']","[class*='city-name']:first-child"], dest: ["span[class*='destCity']"] },
    goibibo:    { origin: ["[data-testid='origin']","[class*='FromCity']"], dest: ["[data-testid='dest']","[class*='ToCity']"] },
    yatra:      { origin: ["[class*='OriginCity']","#Origin"], dest: ["[class*='DestCity']","#Destination"] },
  };

  const CITY_KM = { "del-mum":1150,"mum-del":1150,"del-blr":1740,"blr-del":1740,"del-hyd":1250,"hyd-del":1250,"mum-blr":840,"blr-mum":840,"mum-hyd":620,"hyd-mum":620,"blr-hyd":500,"hyd-blr":500,"blr-chn":300,"chn-blr":300,"del-kol":1300,"kol-del":1300 };

  function cityCode(name) {
    const m = { "delhi":"del","new delhi":"del","mumbai":"mum","bombay":"mum","bangalore":"blr","bengaluru":"blr","hyderabad":"hyd","kolkata":"kol","calcutta":"kol","chennai":"chn","madras":"chn" };
    const l = (name||"").toLowerCase();
    for (const [k,v] of Object.entries(m)) if (l.includes(k)) return v;
    return l.slice(0,3);
  }

  function q(sels) { for (const s of sels) { try { const e = document.querySelector(s); if(e) return e; } catch {} } return null; }

  let lastKey = null, active = false;
  /** @type {number|null} Local timer ID (prevents global window pollution) */
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

    const sel = SELECTORS[SITE];
    if (!sel) { active = false; return; }

    const origin = q(sel.origin)?.textContent?.trim() || "";
    const dest   = q(sel.dest)?.textContent?.trim() || "";
    if (!origin || !dest) { active = false; return; }

    const key = `${origin}_${dest}`;
    if (key === lastKey) { active = false; return; }
    lastKey = key;

    const siteLabel = SITE === "makemytrip" ? "MakeMyTrip" : SITE === "ixigo" ? "Ixigo" : SITE === "goibibo" ? "Goibibo" : "Yatra";
    showComingSoonBanner(siteLabel);
  }

  if (/flight|air|fly/i.test(location.pathname + location.search)) {
    setTimeout(analyze, 2500);

    const travelObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(analyze, 1200);
    });

    if (document.body) {
      travelObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("pagehide", () => travelObserver.disconnect(), { once: true });
  }
})();
