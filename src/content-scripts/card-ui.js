/**
 * card-ui.js — Shared comparison card HTML builder
 * Injected before all content scripts via manifest.
 * Sets window.buildCardHTML used by food, cab, travel content scripts.
 * Ecommerce has its own buildEcommerceCard with site-search strip.
 */

(function () {
  "use strict";

  window.buildCardHTML = function buildCardHTML(result, label) {
    const {
      co2_kg = 0, severity = "medium", analogy = "",
      credit_delta = 0,
      current_pros = [], current_cons = [],
      alternative_name = "Eco alternative",
      alternative_co2_kg = 0,
      alternative_pros = [], alternative_cons = [],
      saving_kg = 0, saving_message = "",
      usedFallback = false,
    } = result;

    const sevMap = {
      low:      { color:"#1a9e6e", label:"Low impact",      icon:"🟢" },
      medium:   { color:"#e6a817", label:"Moderate impact", icon:"🟡" },
      high:     { color:"#e07b39", label:"High impact",     icon:"🟠" },
      critical: { color:"#c0392b", label:"Critical impact", icon:"🔴" },
    };
    const sev = sevMap[severity] || sevMap.medium;

    const total  = co2_kg + alternative_co2_kg + 0.001;
    const pct    = Math.min((co2_kg / total) * 100, 95).toFixed(0);
    const altPct = (100 - Number(pct)).toFixed(0);

    function safe(s) {
      const d = document.createElement("div");
      d.textContent = String(s || "");
      return d.innerHTML;
    }

    function prosLi(items, color) {
      return (Array.isArray(items) ? items : [items]).slice(0, 2).map(p =>
        `<li style="color:${color};padding:2px 0;font-size:12px;list-style:none;display:flex;gap:5px;line-height:1.4">
          <span style="flex-shrink:0">✓</span><span>${safe(p)}</span></li>`
      ).join("");
    }

    function consLi(items) {
      return (Array.isArray(items) ? items : [items]).slice(0, 2).map(p =>
        `<li style="color:#999;padding:2px 0;font-size:12px;list-style:none;display:flex;gap:5px;line-height:1.4">
          <span style="flex-shrink:0">✗</span><span>${safe(p)}</span></li>`
      ).join("");
    }

    const shortLabel = safe(label.split("·")[0].trim()).slice(0, 45);
    const shortAlt   = safe(alternative_name).split(" ").slice(0, 4).join(" ");

    return `
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  .card{background:#fff;border-radius:16px;box-shadow:0 12px 44px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.1);overflow:hidden;animation:rise .3s cubic-bezier(.34,1.56,.64,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.card{animation:none}}
  .hd{background:${sev.color};color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px}
  .hd-lbl{font-size:13px;font-weight:700;flex:1;letter-spacing:.02em}
  .hd-badge{font-size:10px;font-weight:700;background:rgba(255,255,255,.22);padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  .hd-x{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:2px 5px;border-radius:4px;line-height:1;opacity:.8;flex-shrink:0}
  .hd-x:hover{opacity:1;background:rgba(0,0,0,.15)}
  .hd-x:focus-visible{outline:2px solid #fff}
  .analogy{padding:10px 14px;font-size:13px;font-weight:500;color:#1a1a1a;line-height:1.5;border-bottom:1px solid #f0f0f0}
  .fallback{font-size:10px;color:#aaa;font-style:italic;margin-top:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr}
  .col{padding:10px 12px 8px}
  .col-a{border-right:1px solid #f0f0f0}
  .col-b{background:#f6fdf9}
  .tag{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
  .tag-a{color:${sev.color}}
  .tag-b{color:#1a9e6e}
  .col-name{font-size:12px;font-weight:600;color:#1a1a1a;margin-bottom:5px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .bar-bg{height:5px;border-radius:3px;background:#efefef;overflow:hidden;margin-bottom:3px}
  .bar-fill{height:100%;border-radius:3px}
  .bar-a{background:${sev.color};width:${pct}%}
  .bar-b{background:#1a9e6e;width:${altPct}%}
  .co2n{font-size:16px;font-weight:700}
  .co2n-a{color:${sev.color}}
  .co2n-b{color:#1a9e6e}
  .co2u{font-size:10px;color:#888;font-weight:400}
  ul{padding:0;margin-top:7px;list-style:none}
  .saving{background:#e8f8f1;padding:8px 14px;display:flex;align-items:center;gap:8px;border-top:1px solid #d0f0e0}
  .saving-ico{font-size:15px;flex-shrink:0}
  .saving-txt{font-size:12px;font-weight:600;color:#1a5c3e;flex:1;line-height:1.4}
  .saving-kg{font-size:13px;font-weight:700;color:#1a9e6e;white-space:nowrap;flex-shrink:0}
  .credits{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #f0f0f0;align-items:center}
  .pill{font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px}
  .pill-neg{background:#fdecea;color:#c0392b}
  .pill-pos{background:#e8f8f1;color:#1a9e6e}
  .c-lbl{font-size:11px;color:#888;flex:1}
  .btns{display:flex;gap:8px;padding:0 12px 12px}
  .btn-sw{flex:1;background:#1a9e6e;color:#fff;border:none;border-radius:10px;padding:10px 10px;font-size:13px;font-weight:700;cursor:pointer;line-height:1.3;text-align:center;transition:background .15s}
  .btn-sw:hover{background:#148a5e}
  .btn-sw:focus-visible{outline:2px solid #1a9e6e;outline-offset:2px}
  .btn-pr{flex:1;background:none;border:1px solid #e0e0e0;border-radius:10px;padding:10px 10px;font-size:12px;color:#888;cursor:pointer;line-height:1.3;text-align:center;transition:background .15s}
  .btn-pr:hover{background:#f5f5f5}
  .btn-pr:focus-visible{outline:2px solid #aaa;outline-offset:2px}
  .brand{display:flex;justify-content:center;padding:0 0 8px;font-size:10px;font-weight:700;color:#ccc;letter-spacing:.1em}
</style>

<div class="card" role="alertdialog" aria-modal="true">
  <div class="hd">
    <span style="font-size:16px;flex-shrink:0" aria-hidden="true">🌿</span>
    <span class="hd-lbl">Carbon Comparison</span>
    <span class="hd-badge">${sev.icon} ${safe(sev.label)}</span>
    <button class="hd-x" id="btn-close" aria-label="Dismiss">✕</button>
  </div>

  <div class="analogy">
    ${safe(analogy)}
    ${usedFallback ? '<p class="fallback">⚠ Offline estimate — add Gemini API key for live AI analysis</p>' : ''}
  </div>

  <div class="grid">
    <div class="col col-a">
      <div class="tag tag-a">Your choice</div>
      <div class="col-name">${shortLabel}</div>
      <div class="bar-bg"><div class="bar-fill bar-a"></div></div>
      <span class="co2n co2n-a">${Number(co2_kg).toFixed(1)}</span>
      <span class="co2u"> kg CO₂e</span>
      <ul>${prosLi(current_pros, sev.color)}${consLi(current_cons)}</ul>
    </div>
    <div class="col col-b">
      <div class="tag tag-b">Greener choice ✓</div>
      <div class="col-name">${safe(alternative_name)}</div>
      <div class="bar-bg"><div class="bar-fill bar-b"></div></div>
      <span class="co2n co2n-b">${Number(alternative_co2_kg).toFixed(1)}</span>
      <span class="co2u"> kg CO₂e</span>
      <ul>${prosLi(alternative_pros, "#1a9e6e")}${consLi(alternative_cons)}</ul>
    </div>
  </div>

  <div class="saving">
    <span class="saving-ico" aria-hidden="true">🌱</span>
    <span class="saving-txt">${safe(saving_message)}</span>
    <span class="saving-kg">−${Number(saving_kg).toFixed(1)} kg</span>
  </div>

  <div class="credits">
    <span class="pill pill-neg" aria-label="${credit_delta} points">${credit_delta > 0 ? "+" : ""}${credit_delta} pts</span>
    <span class="c-lbl">Switch → <strong class="pill pill-pos">+${Math.abs(credit_delta)} pts</strong></span>
  </div>

  <div class="btns">
    <button class="btn-sw" id="btn-switch">Switch to ${shortAlt}</button>
    <button class="btn-pr" id="btn-proceed">Keep original</button>
  </div>

  <div class="brand">ECOSCORE · CARBON AWARENESS</div>
</div>`;
  };

  window.buildComingSoonCardHTML = function buildComingSoonCardHTML(siteName) {
    const capitalizedSite = siteName.charAt(0).toUpperCase() + siteName.slice(1);
    return `
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  .card{background:#fff;border-radius:16px;box-shadow:0 12px 44px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.1);overflow:hidden;animation:rise .3s cubic-bezier(.34,1.56,.64,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.card{animation:none}}
  .hd{background:#1a9e6e;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px}
  .hd-lbl{font-size:13px;font-weight:700;flex:1;letter-spacing:.02em}
  .hd-x{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:2px 5px;border-radius:4px;line-height:1;opacity:.8;flex-shrink:0}
  .hd-x:hover{opacity:1;background:rgba(0,0,0,.15)}
  .hd-x:focus-visible{outline:2px solid #fff}
  .body{padding:20px 16px;text-align:center}
  .icon{font-size:32px;margin-bottom:12px}
  .title{font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
  .desc{font-size:13px;color:#666;line-height:1.5;margin-bottom:16px}
  .btn-pr{width:100%;background:#1a9e6e;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s}
  .btn-pr:hover{background:#148a5e}
  .brand{display:flex;justify-content:center;padding:0 0 8px;font-size:10px;font-weight:700;color:#ccc;letter-spacing:.1em}
</style>

<div class="card" role="alertdialog" aria-modal="true">
  <div class="hd">
    <span style="font-size:16px;flex-shrink:0" aria-hidden="true">🌿</span>
    <span class="hd-lbl">EcoScore</span>
    <button class="hd-x" id="btn-close" aria-label="Dismiss">✕</button>
  </div>

  <div class="body">
    <div class="icon">🚀</div>
    <div class="title">${capitalizedSite} Carbon Analysis</div>
    <p class="desc">EcoScore carbon footprint tracking and sustainable alternative suggestions for ${capitalizedSite} are coming soon!</p>
    <button class="btn-pr" id="btn-proceed">Got it</button>
  </div>

  <div class="brand">ECOSCORE · CARBON AWARENESS</div>
</div>`;
  };

})();
