/**
 * banner.js — Carbon comparison card injector
 *
 * Shows a side-by-side comparison of current choice vs greener alternative
 * with pros/cons, CO2 numbers, and credit impact. Uses Shadow DOM.
 * NO ES module imports — this file is injected as a plain content script.
 */

const BANNER_ID = "ecoscore-root";

export function injectBanner(result, actionLabel, onAccept, onDismiss) {
  removeBanner();

  const {
    co2_kg, severity, analogy, credit_delta,
    current_pros = [], current_cons = [],
    alternative_name, alternative_co2_kg,
    alternative_pros = [], alternative_cons = [],
    saving_kg, saving_message,
    usedFallback = false,
  } = result;

  const severityMeta = {
    low:      { color: "#1a9e6e", bg: "#e8f8f1", label: "Low impact",      icon: "🟢" },
    medium:   { color: "#e6a817", bg: "#fdf7e4", label: "Moderate impact", icon: "🟡" },
    high:     { color: "#e07b39", bg: "#fdf0e6", label: "High impact",     icon: "🟠" },
    critical: { color: "#c0392b", bg: "#fce8e6", label: "Critical impact", icon: "🔴" },
  };
  const sev = severityMeta[severity] || severityMeta.medium;

  const pct = Math.min((co2_kg / (co2_kg + alternative_co2_kg + 0.001)) * 100, 95).toFixed(0);
  const altPct = (100 - Number(pct)).toFixed(0);

  function prosHTML(items, color) {
    return items.slice(0, 2).map(p =>
      `<li style="color:${color};padding:2px 0;font-size:12px;list-style:none;display:flex;gap:5px;align-items:flex-start">
        <span style="flex-shrink:0;margin-top:1px">✓</span><span>${sanitize(String(p))}</span>
      </li>`
    ).join("");
  }

  function consHTML(items) {
    return items.slice(0, 2).map(p =>
      `<li style="color:#888;padding:2px 0;font-size:12px;list-style:none;display:flex;gap:5px;align-items:flex-start">
        <span style="flex-shrink:0;margin-top:1px">✗</span><span>${sanitize(String(p))}</span>
      </li>`
    ).join("");
  }

  const host = document.createElement("div");
  host.id = BANNER_ID;
  host.style.cssText = [
    "position:fixed", "bottom:16px", "right:16px",
    "z-index:2147483647",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "max-width:420px", "width:calc(100vw - 32px)",
  ].join(";");
  host.setAttribute("role", "alertdialog");
  host.setAttribute("aria-label", "EcoScore carbon comparison");

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .card {
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1);
    overflow: hidden;
    animation: rise 0.35s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  @keyframes rise {
    from { opacity:0; transform:translateY(20px) scale(0.96); }
    to   { opacity:1; transform:translateY(0)    scale(1); }
  }
  @media (prefers-reduced-motion:reduce) { .card { animation:none; } }

  /* ── Header ── */
  .hd {
    background: ${sev.color};
    color: #fff;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hd-icon { font-size: 16px; flex-shrink:0; }
  .hd-label { font-size: 13px; font-weight: 700; flex:1; letter-spacing:.02em; }
  .hd-badge {
    font-size: 10px; font-weight: 700;
    background: rgba(255,255,255,0.22);
    padding: 2px 8px; border-radius: 20px;
    text-transform: uppercase; letter-spacing:.06em;
  }
  .hd-close {
    background: none; border: none; color: #fff;
    font-size: 18px; cursor: pointer; padding: 2px 4px;
    border-radius: 4px; line-height:1; opacity:.8;
    flex-shrink:0;
  }
  .hd-close:hover { opacity:1; background:rgba(0,0,0,0.15); }
  .hd-close:focus-visible { outline:2px solid #fff; }

  /* ── Analogy ── */
  .analogy {
    padding: 10px 14px 0;
    font-size: 13px; font-weight: 500; color: #1a1a1a;
    line-height: 1.5;
    border-bottom: 1px solid #f0f0f0;
    padding-bottom: 10px;
  }
  .fallback-note {
    font-size: 10px; color: #aaa; margin-top: 4px;
    font-style: italic;
  }

  /* ── Comparison grid ── */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .col {
    padding: 12px 12px 10px;
  }
  .col-current  { border-right: 1px solid #f0f0f0; }
  .col-alt      { background: #f6fdf9; }

  .col-tag {
    font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing:.08em;
    margin-bottom: 4px;
  }
  .tag-current { color: ${sev.color}; }
  .tag-alt     { color: #1a9e6e; }

  .col-name {
    font-size: 12px; font-weight: 600; color: #1a1a1a;
    margin-bottom: 6px;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
  }

  /* CO2 bar */
  .co2-bar-wrap { margin-bottom: 6px; }
  .co2-bar-bg {
    height: 6px; border-radius: 3px; background: #efefef;
    overflow: hidden; margin-bottom: 3px;
  }
  .co2-bar-fill { height: 100%; border-radius: 3px; }
  .bar-current-fill { background: ${sev.color}; width: ${pct}%; }
  .bar-alt-fill     { background: #1a9e6e; width: ${altPct}%; }
  .co2-num {
    font-size: 15px; font-weight: 700;
  }
  .num-current { color: ${sev.color}; }
  .num-alt     { color: #1a9e6e; }
  .co2-unit { font-size: 10px; color: #888; font-weight:400; }

  .pros-cons { margin-top: 8px; }
  ul { padding:0; list-style:none; }

  /* ── Saving strip ── */
  .saving {
    background: #e8f8f1;
    padding: 8px 14px;
    display: flex; align-items: center; gap: 8px;
    border-top: 1px solid #d0f0e0;
  }
  .saving-leaf { font-size: 16px; flex-shrink:0; }
  .saving-text { font-size: 12px; font-weight: 600; color: #1a5c3e; flex:1; line-height:1.4; }
  .saving-kg {
    font-size: 13px; font-weight: 700; color: #1a9e6e;
    flex-shrink:0; white-space:nowrap;
  }

  /* ── Credit row ── */
  .credit-row {
    display: flex; gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #f0f0f0;
    align-items: center;
  }
  .pill {
    font-size: 12px; font-weight: 700;
    padding: 3px 10px; border-radius: 20px;
  }
  .pill-neg { background: #fdecea; color: #c0392b; }
  .pill-pos { background: #e8f8f1; color: #1a9e6e; }
  .credit-label { font-size: 11px; color: #888; flex:1; }

  /* ── CTA buttons ── */
  .btns { display: flex; gap: 8px; padding: 0 12px 12px; }
  .btn-switch {
    flex:1; background: #1a9e6e; color: #fff;
    border: none; border-radius: 10px;
    padding: 10px 12px; font-size: 13px; font-weight: 700;
    cursor: pointer; transition: background .15s;
    line-height: 1.3; text-align:center;
  }
  .btn-switch:hover { background: #148a5e; }
  .btn-switch:focus-visible { outline: 2px solid #1a9e6e; outline-offset:2px; }

  .btn-proceed {
    flex:1; background: none;
    border: 1px solid #e0e0e0; border-radius: 10px;
    padding: 10px 12px; font-size: 12px; color: #888;
    cursor: pointer; transition: background .15s;
    line-height: 1.3; text-align:center;
  }
  .btn-proceed:hover { background: #f5f5f5; }
  .btn-proceed:focus-visible { outline: 2px solid #aaa; outline-offset:2px; }

  .brand-row {
    display:flex; justify-content:center;
    padding: 0 0 8px;
    font-size: 10px; font-weight:700; color:#ccc;
    letter-spacing:.1em;
  }
</style>

<div class="card">

  <!-- Header -->
  <div class="hd">
    <span class="hd-icon" aria-hidden="true">🌿</span>
    <span class="hd-label">Carbon Comparison</span>
    <span class="hd-badge">${sev.icon} ${sev.label}</span>
    <button class="hd-close" id="btn-close" aria-label="Dismiss">✕</button>
  </div>

  <!-- Analogy -->
  <div class="analogy">
    ${sanitize(analogy)}
    ${usedFallback ? '<p class="fallback-note">⚠ Offline estimate — add Gemini API key for live analysis</p>' : ''}
  </div>

  <!-- Comparison grid -->
  <div class="grid">
    <div class="col col-current">
      <div class="col-tag tag-current">Your choice</div>
      <div class="col-name">${sanitize(actionLabel.split("·")[0].trim())}</div>
      <div class="co2-bar-wrap">
        <div class="co2-bar-bg"><div class="co2-bar-fill bar-current-fill"></div></div>
        <span class="co2-num num-current">${Number(co2_kg).toFixed(1)}</span>
        <span class="co2-unit"> kg CO₂e</span>
      </div>
      <div class="pros-cons">
        <ul>${prosHTML(current_pros, sev.color)}</ul>
        <ul>${consHTML(current_cons)}</ul>
      </div>
    </div>

    <div class="col col-alt">
      <div class="col-tag tag-alt">Greener choice</div>
      <div class="col-name">${sanitize(alternative_name)}</div>
      <div class="co2-bar-wrap">
        <div class="co2-bar-bg"><div class="co2-bar-fill bar-alt-fill"></div></div>
        <span class="co2-num num-alt">${Number(alternative_co2_kg).toFixed(1)}</span>
        <span class="co2-unit"> kg CO₂e</span>
      </div>
      <div class="pros-cons">
        <ul>${prosHTML(alternative_pros, "#1a9e6e")}</ul>
        <ul>${consHTML(alternative_cons)}</ul>
      </div>
    </div>
  </div>

  <!-- Saving strip -->
  <div class="saving">
    <span class="saving-leaf" aria-hidden="true">🌱</span>
    <span class="saving-text">${sanitize(saving_message)}</span>
    <span class="saving-kg">−${Number(saving_kg).toFixed(1)} kg CO₂</span>
  </div>

  <!-- Credit row -->
  <div class="credit-row">
    <span class="pill pill-neg" aria-label="${credit_delta} EcoCredits">${credit_delta > 0 ? "+" : ""}${credit_delta} pts</span>
    <span class="credit-label">Switch for <strong class="pill-pos" style="padding:2px 6px;border-radius:12px;background:#e8f8f1;color:#1a9e6e">+${Math.abs(credit_delta)} pts</strong></span>
  </div>

  <!-- Buttons -->
  <div class="btns">
    <button class="btn-switch" id="btn-switch">
      Switch to ${sanitize(alternative_name.split(" ").slice(0,3).join(" "))}
    </button>
    <button class="btn-proceed" id="btn-proceed">
      Keep original
    </button>
  </div>

  <div class="brand-row">ECOSCORE · CARBON AWARENESS</div>
</div>
  `;

  // Events
  shadow.getElementById("btn-close").onclick   = () => { removeBanner(); onDismiss?.("dismissed"); };
  shadow.getElementById("btn-proceed").onclick = () => { removeBanner(); onDismiss?.("proceeded"); };
  shadow.getElementById("btn-switch").onclick  = () => { removeBanner(); onAccept?.(); };

  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { removeBanner(); onDismiss?.("keyboard"); document.removeEventListener("keydown", esc); }
  });

  document.body.appendChild(host);
  setTimeout(() => shadow.getElementById("btn-switch")?.focus(), 380);
}

export function removeBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

function sanitize(str) {
  const d = document.createElement("div");
  d.textContent = String(str || "");
  return d.innerHTML;
}
