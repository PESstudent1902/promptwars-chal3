/**
 * content-ecommerce.js — Amazon India, Flipkart, Myntra
 * 
 * NEW: Searches the SAME website for a greener alternative product
 * and shows a clickable link to it inside the comparison card.
 */

(function () {
  "use strict";

  const hostname = location.hostname;
  const SITE = hostname.includes("amazon") ? "amazon"
    : hostname.includes("flipkart") ? "flipkart" : "myntra";

  // ── Timing Constants ────────────────────────────────────────────────────────
  const DEBOUNCE_DELAY_MS = 2000;
  const INITIAL_DELAY_MS = 2500;
  const CLICK_DELAY_MS = 300;

  const SELECTORS = {
    amazon: {
      title:    ["#productTitle", "h1.a-size-large", "#title span"],
      delivery: ["#deliveryBlockMessage", ".a-color-success", "#mir-layout-DELIVERY_BLOCK"],
      category: ["#wayfinding-breadcrumbs_feature_div a", ".a-breadcrumb a"],
      addCart:  ["#add-to-cart-button", "#buy-now-button"],
      image:    ["#landingImage", "#imgBlkFront", "#main-image-container img", "#imageBlock img", "#prodDetails img"],
    },
    flipkart: {
      title:    ["span.B_NuCI", "h1.yhB1nd", "h1", "span.VU-ZEz"],
      delivery: ["._16FRp0", "._2Tpdn3"],
      category: ["._2whKao a", "a._1LKTO3"],
      addCart:  ["button._2KpZ6l", "button._3v1Smh"],
      image:    ["img._396cs4", "img._2r_l1x", "div._3D0C1u img", "div.cxoR9U img", ".qomrSF img", "img[src*='/image/']"],
    },
    myntra: {
      title:    ["h1.pdp-name", "h1[class*='pdp']", "h1[class*='product']", "h1"],
      delivery: ["[class*='delivery']"],
      category: ["[class*='breadcrumb'] a", "nav a"],
      addCart:  ["[data-testid='add-to-bag']", "button[class*='addToBag']"],
      image:    ["img.pdp-draggable-image", "div.image-grid-image", "div.image-grid-container img", "img[src*='myntrainfo']"],
    },
  };

  // ── Search for greener alternative ON THE SAME SITE ──────────────────────

  /**
   * Build a search URL for a greener version of the product on the same site.
   * Returns { searchUrl, searchQuery }
   */
  function extractProductQuery(title, ecoCategory) {
    const t = (title + " " + (ecoCategory || "")).toLowerCase();
    
    if (/\b(mat|mats|rug|rugs|carpet|carpets|doormat|doormats)\b/i.test(t)) return "jute door mat";
    if (/\b(pot|pots|planter|planters|garden|plant|plants|seeds)\b/i.test(t)) return "coco coir pots";
    if (/\b(bottle|bottles|flask|flasks)\b/i.test(t)) return "stainless steel water bottle";
    if (/\b(cup|cups|mug|mugs|glass|glasses|tumbler|tumblers)\b/i.test(t)) return "reusable bamboo mug";
    if (/\b(bag|bags|backpack|backpacks|tote|totes)\b/i.test(t)) return "organic cotton tote bag";
    if (/\b(shoes?|sneakers?|footwear|sandals?|boots?)\b/i.test(t)) return "sustainable canvas sneakers";
    if (/\b(shirt|shirts|t-shirt|t-shirts|tshirt|tshirts|jeans|denim|dress|dresses|clothing|wear|apparel)\b/i.test(t)) return "organic cotton t-shirt";
    if (/\b(toy|toys|game|games|doll|dolls|puzzle|puzzles)\b/i.test(t)) return "wooden toy eco friendly";
    if (/\b(plate|plates|bowl|bowls|spoon|spoons|fork|forks|knife|knives|cutlery|utensil|utensils|dinnerware)\b/i.test(t)) return "bamboo plates eco friendly";
    if (/\b(detergent|detergents|soap|soaps|shampoo|shampoos|dishwash|dishwashing)\b/i.test(t)) return "organic natural dishwash";
    if (/\b(phone|phones|smartphone|smartphones|iphone|iphones)\b/i.test(t)) return "refurbished smartphone";
    if (/\b(laptop|laptops|computer|computers|macbook|macbooks)\b/i.test(t)) return "refurbished laptop";
    if (/\b(sofa|sofas|mattress|mattresses|furniture|wardrobe|wardrobes|table|tables|chair|chairs|desk|desks|bed|beds)\b/i.test(t)) return "reclaimed wood furniture";

    return null;
  }

  function buildGreenSearchUrl(title, ecoCategory) {
    const query = extractProductQuery(title, ecoCategory);
    if (!query) return null;
    let searchUrl = "";

    if (SITE === "amazon") {
      searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
    } else if (SITE === "flipkart") {
      searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
    } else if (SITE === "myntra") {
      searchUrl = `https://www.myntra.com/${encodeURIComponent(query.replace(/\s+/g, "-"))}`;
    }

    return { searchUrl, searchQuery: query };
  }

  function getSearchUrlForProduct(productName) {
    if (!productName) return "";
    const query = productName;
    if (SITE === "amazon") {
      return `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
    } else if (SITE === "flipkart") {
      return `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
    } else if (SITE === "myntra") {
      return `https://www.myntra.com/${encodeURIComponent(query.replace(/\s+/g, "-"))}`;
    }
    return "";
  }

  function fetchHtmlViaBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "FETCH_HTML",
        payload: { url }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Try to fetch the first product result from the same origin.
   */
  async function fetchAlternativeProductDetails(url) {
    try {
      const html = await fetchHtmlViaBackground(url).catch(() => "");
      if (!html) return "";
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      let text = "";
      if (SITE === "amazon") {
        const bullets = doc.querySelectorAll("#feature-bullets li span");
        if (bullets.length > 0) {
          text = Array.from(bullets).map(el => el.textContent.trim()).join("; ");
        } else {
          const desc = doc.querySelector("#productDescription p");
          text = desc ? desc.textContent.trim() : "";
        }
      } else if (SITE === "flipkart") {
        const desc = doc.querySelector("._1mX1wR, ._2KmwZ3, ._2-rZJM");
        text = desc ? desc.textContent.trim() : "";
      } else if (SITE === "myntra") {
        const desc = doc.querySelector(".pdp-product-description-content");
        text = desc ? desc.textContent.trim() : "";
      }
      return text.slice(0, 400).replace(/\s+/g, " ");
    } catch (err) {
      console.warn("[EcoScore] Error fetching alternative product details:", err);
      return "";
    }
  }

  /**
   * Try to fetch the first product result from the same site's search page.
   */
  async function findGreenAlternativeOnSite(title, ecoCategory, isDirect = false) {
    let searchQuery = title;
    let searchUrl = "";

    if (isDirect) {
      searchUrl = getSearchUrlForProduct(title);
    } else {
      const qObj = buildGreenSearchUrl(title, ecoCategory);
      if (!qObj) return null;
      searchQuery = qObj.searchQuery;
      searchUrl = qObj.searchUrl;
    }

    try {
      const html = await fetchHtmlViaBackground(searchUrl);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      let altProduct = null;

      if (SITE === "amazon") {
        const items = doc.querySelectorAll('div[data-component-type="s-search-result"]');
        for (const item of items) {
          const isSponsored = item.textContent.toLowerCase().includes("sponsored") || item.querySelector('.puis-sponsored-label-text');
          const titleEl = item.querySelector('h2 a span');
          const linkEl = item.querySelector('h2 a');
          const imgEl = item.querySelector('img.s-image');
          
          if (titleEl && linkEl && imgEl) {
            let url = linkEl.getAttribute("href");
            if (url && !url.startsWith("http")) {
              url = "https://www.amazon.in" + url;
            }
            altProduct = {
              title: titleEl.textContent.trim(),
              url: url,
              img: imgEl.getAttribute("src"),
            };
            if (!isSponsored) break;
          }
        }
      } else if (SITE === "flipkart") {
        const links = doc.querySelectorAll('a[href*="/p/"]');
        for (const link of links) {
          const titleEl = link.querySelector('div._4rR01T, div._2WkVRV, div.VU-ZEz, .s1Q9rs');
          const imgEl = link.querySelector('img');
          let titleText = titleEl ? titleEl.textContent.trim() : (link.getAttribute("title") || "");
          if (!titleText && imgEl) {
            titleText = imgEl.getAttribute("alt") || "";
          }
          
          if (titleText && imgEl) {
            let url = link.getAttribute("href");
            if (url && !url.startsWith("http")) {
              url = "https://www.flipkart.com" + url;
            }
            altProduct = {
              title: titleText,
              url: url,
              img: imgEl.getAttribute("src"),
            };
            break;
          }
        }
      } else if (SITE === "myntra") {
        const items = doc.querySelectorAll('li.product-base');
        for (const item of items) {
          const linkEl = item.querySelector('a');
          const brandEl = item.querySelector('h3.product-brand');
          const nameEl = item.querySelector('h4.product-product');
          const imgEl = item.querySelector('img.product-thumb, picture img');

          if (linkEl && imgEl) {
            let url = linkEl.getAttribute("href");
            if (url && !url.startsWith("http")) {
              url = "https://www.myntra.com/" + url;
            }
            const brand = brandEl ? brandEl.textContent.trim() : "";
            const name = nameEl ? nameEl.textContent.trim() : "";
            altProduct = {
              title: brand ? `${brand} ${name}` : name || "Eco Alternative",
              url: url,
              img: imgEl.getAttribute("src") || imgEl.getAttribute("data-src"),
            };
            break;
          }
        }
      }

      if (altProduct) {
        const details = await fetchAlternativeProductDetails(altProduct.url);
        return {
          found: true,
          searchUrl,
          searchQuery,
          alternativeName: altProduct.title,
          alternativeUrl: altProduct.url,
          alternativeImage: altProduct.img,
          alternativeDetails: details,
          displayText: `Switch to ${altProduct.title}`,
          isSearchLink: false,
        };
      }

      return {
        found: true,
        searchUrl,
        searchQuery,
        displayText: `Search "${searchQuery}" on ${SITE.charAt(0).toUpperCase() + SITE.slice(1)}`,
        isSearchLink: true,
      };
    } catch (err) {
      console.warn("[EcoScore] Error fetching alternative:", err);
      return { found: false, searchUrl, searchQuery, isSearchLink: true };
    }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function queryFirst(sels, root = document) {
    for (const s of sels) { try { const e = root.querySelector(s); if (e) return e; } catch {} }
    return null;
  }

  function classify(title, cat) {
    const t = (title + " " + cat).toLowerCase();
    
    let res;
    if (/\b(laptop|macbook|gaming pc|imac|desktop)\b/i.test(t))    res = { cat:"laptop/PC",            sev:"critical", score:-35 };
    else if (/\b(iphone|samsung galaxy|pixel|oneplus|smartphone|smartphones|phone|phones|android)\b/i.test(t)) res = { cat:"smartphone",     sev:"high",     score:-25 };
    else if (/\b(tablet|tablets|ipad)\b/i.test(t))                               res = { cat:"tablet",               sev:"high",     score:-20 };
    else if (/\b(headphone|headphones|earbud|earbuds|speaker|speakers|smartwatch|smartwatches)\b/i.test(t))       res = { cat:"electronics accessory",sev:"medium",   score:-15 };
    else if (/\b(mat|mats|rug|rugs|carpet|carpets|doormat|doormats|curtain|curtains|towel|towels|bedsheet|bedsheets|pillow|pillows|linen|linens)\b/i.test(t)) {
      if (/\b(polyester|nylon|synthetic|synthetics)\b/i.test(t))               res = { cat:"synthetic home decor", sev:"medium",   score:-12 };
      else if (/\b(jute|coir|bamboo|organic|natural)\b/i.test(t))         res = { cat:"sustainable home decor", sev:"low",    score:-4  };
      else res = { cat:"home decor", sev:"medium", score:-8 };
    }
    else if (/\b(polyester|nylon|synthetic|synthetics)\b/i.test(t) && /\b(shirt|shirts|tshirt|tshirts|t-shirt|t-shirts|jeans|dress|dresses|kurta|kurtas|saree|sarees|wear|apparel|clothing|garment|garments|socks)\b/i.test(t)) {
      res = { cat:"synthetic clothing",   sev:"high",     score:-18 };
    }
    else if (/\b(organic|handloom|cotton|linen)\b/i.test(t) && /\b(shirt|shirts|tshirt|tshirts|t-shirt|t-shirts|jeans|dress|dresses|kurta|kurtas|saree|sarees|wear|apparel|clothing|garment|garments|socks)\b/i.test(t)) {
      res = { cat:"sustainable clothing", sev:"low",      score:-5  };
    }
    else if (/\b(plastic|disposable|single-use)\b/i.test(t))                        res = { cat:"single-use plastic",   sev:"critical", score:-30 };
    else if (/\b(sofa|sofas|mattress|mattresses|furniture|wardrobe|wardrobes|table|tables|chair|chairs|desk|desks|bed|beds)\b/i.test(t))          res = { cat:"furniture",             sev:"high",     score:-22 };
    else if (/\b(book|books|paperback|paperbacks)\b/i.test(t))                            res = { cat:"book",                  sev:"low",      score:-3  };
    else if (/\b(plant|plants|seeds|garden|compost)\b/i.test(t))                res = { cat:"garden/eco",            sev:"low",      score:5   };
    else if (/\b(shirt|shirts|jeans|dress|dresses|kurta|kurtas|saree|sarees|tshirt|tshirts|t-shirt|t-shirts|wear|apparel|clothing|garment|garments)\b/i.test(t)) res = { cat:"clothing",          sev:"medium",   score:-10 };
    else if (/\b(shoes|sneaker|sneakers|footwear|sandal|sandals|boot|boots|slippers)\b/i.test(t))             res = { cat:"footwear",              sev:"medium",   score:-12 };
    else if (/\b(fridge|refrigerator|refrigerators|washing machine|washing machines|ac|air conditioner|air conditioners)\b/i.test(t)) res = { cat:"large appliance",     sev:"critical", score:-40 };
    else res = { cat:"product", sev:"low", score:-8 };

    const isSustainable = /\b(jute|coir|bamboo|organic|reclaimed|refurbished|recycled|biodegradable|compostable|sustainable|eco-friendly|ecofriendly|fair-trade|fairtrade|khadi|handloom)\b/i.test(t);
    if (isSustainable) {
      res.sev = "low";
      res.score = Math.max(10, Math.abs(res.score));
    }
    return res;
  }

  function isExpress(txt) {
    return /same.day|today|2.hour|express|prime now|instant/i.test(txt);
  }

  // ── Banner with site search link ──────────────────────────────────────────

  let lastKey = null, active = false;

  function extractOriginalImage() {
    const sel = SELECTORS[SITE];
    if (!sel.image) return null;
    const imgEl = queryFirst(sel.image);
    return imgEl ? imgEl.getAttribute("src") : null;
  }

  // Helper to validate that URLs are secure and correct
  function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    return url.startsWith("https://") || url.startsWith("chrome-extension://");
  }

  // ── Sub-templates for buildEcommerceCard ──────────────────────────────

  function getSeverityConfig(severity) {
    const sevMap = {
      low:      { color:"#1a9e6e", label:"Low impact",      icon:"🟢" },
      medium:   { color:"#e6a817", label:"Moderate impact", icon:"🟡" },
      high:     { color:"#e07b39", label:"High impact",     icon:"🟠" },
      critical: { color:"#c0392b", label:"Critical impact", icon:"🔴" },
    };
    return sevMap[severity] || sevMap.medium;
  }

  function safe(s) {
    const d = document.createElement("div");
    d.textContent = String(s || "");
    return d.innerHTML;
  }

  function prosTemplate(items, color) {
    return (Array.isArray(items) ? items : [items]).slice(0, 2).map(p =>
      `<li style="color:${color};font-size:12px;list-style:none;display:flex;gap:5px;padding:2px 0;line-height:1.4"><span style="flex-shrink:0">✓</span><span>${safe(p)}</span></li>`
    ).join("");
  }

  function consTemplate(items) {
    return (Array.isArray(items) ? items : [items]).slice(0, 2).map(p =>
      `<li style="color:#999;font-size:12px;list-style:none;display:flex;gap:5px;padding:2px 0;line-height:1.4"><span style="flex-shrink:0">✗</span><span>${safe(p)}</span></li>`
    ).join("");
  }

  function buildHeaderTemplate(sev) {
    return `
      <div class="hd">
        <span style="font-size:16px;flex-shrink:0" aria-hidden="true">🌿</span>
        <h2 class="hd-lbl" id="card-title">Carbon Comparison</h2>
        <span class="hd-badge">${sev.icon} ${safe(sev.label)}</span>
        <button class="hd-x" id="btn-close" aria-label="Dismiss">✕</button>
      </div>
    `;
  }

  function buildAnalogyTemplate(analogy, usedFallback) {
    return `
      <div class="analogy" id="card-analogy">
        ${safe(analogy)}
        ${usedFallback ? '<p class="fallback">⚠ Offline estimate — add Gemini API key for live AI analysis</p>' : ''}
      </div>
    `;
  }

  function buildGridTemplate({ isAlreadyGreen, originalImage, altImg, co2_kg, alternative_co2_kg, pct, altPct, shortLabel, alternative_name, current_pros, current_cons, alternative_pros, alternative_cons, sev }) {
    if (isAlreadyGreen) {
      return `
      <div style="padding: 18px 14px; text-align: center; background: #e8f8f1; border-top: 1px solid #d0f0e0; border-bottom: 1px solid #d0f0e0; display: flex; flex-direction: column; align-items: center; gap: 8px;">
        <span style="font-size: 32px;" aria-hidden="true">🏆</span>
        <h3 style="color: #1a5c3e; font-size: 15px; margin: 0; font-weight: 700;">Sustainable Choice!</h3>
        <p style="color: #27ae60; font-size: 13px; font-weight: 600; line-height: 1.4; max-width: 320px;">
          This product is already eco-friendly. No greener alternative needed!
        </p>
      </div>
      `;
    }

    const valOriginalImage = isValidImageUrl(originalImage) ? originalImage : null;
    const valAltImg = isValidImageUrl(altImg) ? altImg : null;

    return `
    <div class="grid">
      <div class="col col-a">
        <div class="tag tag-a">Your choice</div>
        ${valOriginalImage ? `
        <div class="img-container">
          <img src="${safe(valOriginalImage)}" alt="Original product" class="prod-img" />
        </div>` : ''}
        <div class="col-name">${shortLabel}</div>
        <div class="bar-bg" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Original choice carbon emission ratio"><div class="bar-fill bar-a"></div></div>
        <span class="co2n co2n-a">${Number(co2_kg).toFixed(1)}</span><span class="co2u"> kg CO₂e</span>
        <ul>${prosTemplate(current_pros, sev.color)}${consTemplate(current_cons)}</ul>
      </div>
      <div class="col col-b">
        <div class="tag tag-b">Greener choice ✓</div>
        ${valAltImg ? `
        <div class="img-container">
          <img src="${safe(valAltImg)}" alt="Eco alternative" class="prod-img" />
        </div>` : ''}
        <div class="col-name">${safe(alternative_name)}</div>
        <div class="bar-bg" role="progressbar" aria-valuenow="${altPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Alternative choice carbon emission ratio"><div class="bar-fill bar-b"></div></div>
        <span class="co2n co2n-b">${Number(alternative_co2_kg).toFixed(1)}</span><span class="co2u"> kg CO₂e</span>
        <ul>${prosTemplate(alternative_pros, "#1a9e6e")}${consTemplate(alternative_cons)}</ul>
      </div>
    </div>
    `;
  }

  function buildSearchStripTemplate(isAlreadyGreen, isDirectLink, stripeTitle, stripeQuery, stripeBtnText, siteName) {
    if (isAlreadyGreen) return "";
    return `
    <div class="site-strip">
      <span class="site-strip-icon" aria-hidden="true">${isDirectLink ? '🌿' : '🔍'}</span>
      <div class="site-strip-body">
        <div class="site-strip-title">${safe(stripeTitle)}</div>
        <div class="site-strip-query">${safe(stripeQuery)}</div>
      </div>
      <button class="btn-find" id="btn-find" aria-label="${isDirectLink ? 'View' : 'Search'} green alternative on ${siteName}">
        ${safe(stripeBtnText)}
      </button>
    </div>
    `;
  }

  function buildSavingTemplate(isAlreadyGreen, saving_message, saving_kg) {
    return `
    <div class="saving">
      <span class="saving-ico" aria-hidden="true">🌱</span>
      <span class="saving-txt">${safe(saving_message)}</span>
      <span class="saving-kg">${isAlreadyGreen ? '0.0' : `−${Number(saving_kg).toFixed(1)}`} kg</span>
    </div>
    `;
  }

  function buildCreditsTemplate(isAlreadyGreen, credit_delta) {
    if (isAlreadyGreen) {
      return `
      <div class="credits">
        <span class="pill pill-pos">${credit_delta > 0 ? "+" : ""}${credit_delta} pts</span>
        <span class="c-lbl">Sustainability bonus earned!</span>
      </div>
      `;
    }
    return `
    <div class="credits">
      <span class="pill pill-neg">${credit_delta > 0 ? "+" : ""}${credit_delta} pts</span>
      <span class="c-lbl">Switch → <strong class="pill pill-pos">+${Math.abs(credit_delta)} pts</strong></span>
    </div>
    `;
  }

  function buildFooterButtonsTemplate(isAlreadyGreen) {
    return `
    <div class="btns">
      <button class="btn-pr" id="btn-proceed" style="${isAlreadyGreen ? 'border-color: #1a9e6e; color: #1a9e6e; font-weight: 700;' : ''}">
        ${isAlreadyGreen ? 'Proceed with purchase ✓' : 'Keep original'}
      </button>
    </div>
    `;
  }

  function buildEcommerceCard(result, label, altInfo, originalImage) {
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

    const sev = getSeverityConfig(severity);

    const total = co2_kg + alternative_co2_kg + 0.001;
    const pct    = Math.min((co2_kg / total) * 100, 95).toFixed(0);
    const altPct = (100 - Number(pct)).toFixed(0);

    const siteName = SITE.charAt(0).toUpperCase() + SITE.slice(1);
    const searchQuery = altInfo?.searchQuery || alternative_name;
    const shortLabel = safe(label.split("·")[0].trim()).slice(0,45);

    // Resolve stable alternative image and URL for fallback products if search failed
    let altImg = altInfo?.alternativeImage;

    if (!altImg && alternative_name) {
      const lowerAlt = alternative_name.toLowerCase();
      if (lowerAlt.includes("neeman")) {
        altImg = chrome.runtime.getURL("assets/neemans_shoes.png");
      } else if (lowerAlt.includes("beco") && lowerAlt.includes("garbage")) {
        altImg = chrome.runtime.getURL("assets/beco_garbage.png");
      } else if (lowerAlt.includes("jute") || lowerAlt.includes("onlymat")) {
        altImg = chrome.runtime.getURL("assets/jute_mat.png");
      } else if (lowerAlt.includes("beco") && lowerAlt.includes("dishwash")) {
        altImg = chrome.runtime.getURL("assets/beco_dishwash.png");
      } else if (lowerAlt.includes("milton")) {
        altImg = chrome.runtime.getURL("assets/milton_bottle.png");
      } else if (lowerAlt.includes("nasties")) {
        altImg = chrome.runtime.getURL("assets/no_nasties_shirt.png");
      } else if (lowerAlt.includes("iphone")) {
        altImg = chrome.runtime.getURL("assets/renewed_iphone.png");
      } else if (lowerAlt.includes("macbook")) {
        altImg = chrome.runtime.getURL("assets/renewed_macbook.png");
      } else if (lowerAlt.includes("toothbrush") || lowerAlt.includes("pot") || lowerAlt.includes("plate") || lowerAlt.includes("toy") || lowerAlt.includes("dinnerware") || lowerAlt.includes("coir")) {
        if (lowerAlt.includes("toothbrush") || lowerAlt.includes("plate") || lowerAlt.includes("dinnerware")) {
          altImg = chrome.runtime.getURL("assets/milton_bottle.png");
        } else if (lowerAlt.includes("toy")) {
          altImg = chrome.runtime.getURL("assets/no_nasties_shirt.png");
        } else {
          altImg = chrome.runtime.getURL("assets/jute_mat.png");
        }
      }
    }

    const isAlreadyGreen = !!(result.is_sustainable_choice || result.isAlreadySustainable || !alternative_name);
    const isDirectLink = !!(altInfo && !altInfo.isSearchLink && altInfo.alternativeUrl);

    const stripeBg = isDirectLink ? "#e8f8f1" : "#f5f6f8";
    const stripeBorder = isDirectLink ? "#d0f0e0" : "#e2e4e8";
    const stripeTitle = isDirectLink ? "Greener alternative found!" : `No specific alternative found on store`;
    const stripeTitleColor = isDirectLink ? "#1a5c3e" : "#555";
    const stripeQuery = isDirectLink ? alternative_name : `Search query: "${searchQuery}"`;
    const stripeBtnText = isDirectLink ? "View Product →" : `Search ${siteName} →`;

    return `
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
.card { background: #fff; border-radius: 16px; box-shadow: 0 12px 44px rgba(0,0,0,.24), 0 2px 8px rgba(0,0,0,.1); overflow: hidden; animation: rise .3s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } }
.hd { background: ${sev.color}; color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 8px; }
.hd-lbl { font-size: 13px; font-weight: 700; flex: 1; }
.hd-badge { font-size: 10px; font-weight: 700; background: rgba(255,255,255,.22); padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
.hd-x { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 2px 5px; border-radius: 4px; opacity: .8; line-height: 1; }
.hd-x:hover { opacity: 1; background: rgba(0,0,0,.15); }
.hd-x:focus-visible { outline: 2px solid #fff; }
.analogy { padding: 10px 14px; font-size: 13px; font-weight: 500; color: #1a1a1a; line-height: 1.5; border-bottom: 1px solid #f0f0f0; }
.fallback { font-size: 10px; color: #aaa; font-style: italic; margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; }
.col { padding: 10px 12px 8px; }
.col-a { border-right: 1px solid #f0f0f0; }
.col-b { background: #f6fdf9; }
.tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 5px; }
.tag-a { color: ${sev.color}; }
.tag-b { color: #1a9e6e; }
.img-container {
  width: 100%;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fdfdfd;
  border-radius: 8px;
  margin-bottom: 8px;
  border: 1px solid #f0f0f0;
  overflow: hidden;
  padding: 4px;
}
.prod-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.col-name { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-bottom: 5px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 32px; }
.bar-bg { height: 5px; border-radius: 3px; background: #efefef; overflow: hidden; margin-bottom: 3px; }
.bar-fill { height: 100%; border-radius: 3px; }
.bar-a { background: ${sev.color}; width: ${pct}%; }
.bar-b { background: #1a9e6e; width: ${altPct}%; }
.co2n { font-size: 16px; font-weight: 700; }
.co2n-a { color: ${sev.color}; }
.co2n-b { color: #1a9e6e; }
.co2u { font-size: 10px; color: #888; font-weight: 400; }
ul { padding: 0; margin-top: 7px; list-style: none; }

/* Site search strip */
.site-strip { background: ${stripeBg}; border-top: 1px solid ${stripeBorder}; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
.site-strip-icon { font-size: 18px; flex-shrink: 0; }
.site-strip-body { flex: 1; min-width: 0; }
.site-strip-title { font-size: 12px; font-weight: 700; color: ${stripeTitleColor}; margin-bottom: 2px; }
.site-strip-query { font-size: 11px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-find { background: #1a9e6e; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background .15s; }
.btn-find:hover { background: #148a5e; }
.btn-find:focus-visible { outline: 2px solid #1a9e6e; outline-offset: 2px; }

.saving { background: #e8f8f1; padding: 8px 14px; display: flex; align-items: center; gap: 8px; border-top: 1px solid #d0f0e0; }
.saving-ico { font-size: 15px; flex-shrink: 0; }
.saving-txt { font-size: 12px; font-weight: 600; color: #1a5c3e; flex: 1; line-height: 1.4; }
.saving-kg { font-size: 13px; font-weight: 700; color: #1a9e6e; white-space: nowrap; }
.credits { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #f0f0f0; align-items: center; }
.pill { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.pill-neg { background: #fdecea; color: #c0392b; }
.pill-pos { background: #e8f8f1; color: #1a9e6e; }
.c-lbl { font-size: 11px; color: #888; flex: 1; }
.btns { display: flex; gap: 8px; padding: 0 12px 12px; }
.btn-pr { flex: 1; background: none; border: 1px solid #e0e0e0; border-radius: 10px; padding: 10px; font-size: 12px; color: #888; cursor: pointer; transition: background .15s; text-align: center; }
.btn-pr:hover { background: #f5f5f5; }
.btn-pr:focus-visible { outline: 2px solid #aaa; outline-offset: 2px; }
.brand { display: flex; justify-content: center; padding: 0 0 8px; font-size: 10px; font-weight: 700; color: #ccc; letter-spacing: .1em; }
</style>

<div class="card" role="alertdialog" aria-modal="true" aria-labelledby="card-title" aria-describedby="card-analogy">
  ${buildHeaderTemplate(sev)}
  ${buildAnalogyTemplate(analogy, usedFallback)}
  ${buildGridTemplate({ isAlreadyGreen, originalImage, altImg, co2_kg, alternative_co2_kg, pct, altPct, shortLabel, alternative_name, current_pros, current_cons, alternative_pros, alternative_cons, sev })}
  ${buildSearchStripTemplate(isAlreadyGreen, isDirectLink, stripeTitle, stripeQuery, stripeBtnText, siteName)}
  ${buildSavingTemplate(isAlreadyGreen, saving_message, saving_kg)}
  ${buildCreditsTemplate(isAlreadyGreen, credit_delta)}
  ${buildFooterButtonsTemplate(isAlreadyGreen)}
  <div class="brand">ECOSCORE · CARBON AWARENESS</div>
</div>`;
  }

  // ── Main analysis ──────────────────────────────────────────────────────────

  async function analyze() {
    if (active) return;
    active = true;
    const sel   = SELECTORS[SITE];
    const titleEl = queryFirst(sel.title);
    const title = titleEl?.textContent?.trim() || "";
    if (title.length < 3) { active = false; return; }

    const key = title.slice(0, 60).toLowerCase();
    if (key === lastKey) { active = false; return; }
    lastKey = key;

    if (SITE !== "amazon") {
      window.EcoScoreUI.showComingSoonBanner(SITE === "flipkart" ? "Flipkart" : SITE === "myntra" ? "Myntra" : SITE);
      return;
    }

    const deliveryTxt = queryFirst(sel.delivery)?.textContent?.trim() || "";
    const catTxt      = queryFirst(sel.category)?.textContent?.trim() || "";
    const { cat, sev, score } = classify(title, catTxt);
    const express = isExpress(deliveryTxt);
    const { user_location } = await chrome.storage.local.get(["user_location"]);

    // Build the green alternative search link BEFORE calling Gemini
    let altInfo = await findGreenAlternativeOnSite(title, cat);
    const originalImage = extractOriginalImage();

    chrome.runtime.sendMessage({
      type: "ANALYZE_ACTION",
      payload: {
        itemName: title.slice(0, 100),
        category: "ecommerce",
        quantity: 1,
        context: {
          ecoCategory: cat,
          severity: sev,
          isExpress: express,
          site: SITE,
          userCity: user_location?.city || null,
          originalImage,
          alternativeName: altInfo?.alternativeName || null,
          alternativeUrl: altInfo?.alternativeUrl || null,
          alternativeImage: altInfo?.alternativeImage || null,
          alternativeDetails: altInfo?.alternativeDetails || null
        },
      },
    }, async (result) => {
      if (chrome.runtime.lastError || !result || result.debounced || result.error) { active = false; return; }

      // Update the search query or fetch specific alternative details
      if (result.alternative_name && !result.usedFallback) {
        // Fetch specific alternative details based on Gemini's recommendation (isDirect = true)
        const geminiAltInfo = await findGreenAlternativeOnSite(result.alternative_name, cat, true);
        if (geminiAltInfo && geminiAltInfo.found && !geminiAltInfo.isSearchLink) {
          altInfo = geminiAltInfo;
          // Sync result details with the live alternative found
          result.alternative_name = altInfo.alternativeName;
        } else {
          altInfo = {
            searchQuery: result.alternative_name,
            searchUrl: getSearchUrlForProduct(result.alternative_name),
            displayText: `Search "${result.alternative_name}" on ${SITE}`,
            isSearchLink: true
          };
        }
      } else if (result.usedFallback) {
        if (!altInfo && result.alternative_name) {
          const offlineAltInfo = await findGreenAlternativeOnSite(result.alternative_name, cat, true);
          if (offlineAltInfo && offlineAltInfo.found && !offlineAltInfo.isSearchLink) {
            altInfo = offlineAltInfo;
            result.alternative_name = altInfo.alternativeName;
            result.alternative_co2_kg = parseFloat((result.co2_kg * 0.35).toFixed(1));
            result.saving_kg = parseFloat((result.co2_kg - result.alternative_co2_kg).toFixed(1));
            result.saving_message = `Switching to this eco-friendly option saves ${result.saving_kg} kg CO₂!`;
            result.current_pros = ["Convenient home delivery", "Fast shipping"];
            result.current_cons = ["High packaging waste", "Non-recyclable materials"];
            result.alternative_pros = ["Plastic-free packaging", "Made of sustainable materials", "Biodegradable"];
            result.alternative_cons = ["Slightly higher cost"];
          } else {
            altInfo = {
              searchQuery: result.alternative_name,
              searchUrl: getSearchUrlForProduct(result.alternative_name),
              displayText: `Search "${result.alternative_name}" on ${SITE}`,
              isSearchLink: true
            };
          }
        } else if (altInfo && !altInfo.isSearchLink) {
          // Offline fallback override: replace "Local store purchase" with the actual parsed search product details!
          result.alternative_name = altInfo.alternativeName;
          // Adjust the fallback carbon math to reflect a realistic saving
          result.alternative_co2_kg = parseFloat((result.co2_kg * 0.35).toFixed(1));
          result.saving_kg = parseFloat((result.co2_kg - result.alternative_co2_kg).toFixed(1));
          result.saving_message = `Switching to this eco-friendly option saves ${result.saving_kg} kg CO₂!`;
          result.current_pros = ["Convenient home delivery", "Fast shipping"];
          result.current_cons = ["High packaging waste", "Non-recyclable materials"];
          result.alternative_pros = ["Plastic-free packaging", "Made of sustainable materials", "Biodegradable"];
          result.alternative_cons = ["Slightly higher cost"];
        }
      }

      active = true;
      const label = `${title.slice(0, 50)}${title.length > 50 ? "…" : ""} · ${SITE}`;
      const cardHtml = buildEcommerceCard(result, label, altInfo, originalImage);

      // Resolve stable targetUrl for action button click
      let targetUrl = altInfo?.alternativeUrl;
      if (!targetUrl && result.alternative_name) {
        targetUrl = getSearchUrlForProduct(result.alternative_name);
      }
      if (!targetUrl) {
        targetUrl = altInfo?.searchUrl;
      }

      window.EcoScoreUI.showBanner(cardHtml, {
        onAccept: () => {
          if (targetUrl) {
            window.open(targetUrl, "_blank", "noopener");
          }
          active = false;
          const targetName = altInfo?.alternativeName || altInfo?.searchQuery || "eco alternative";
          chrome.runtime.sendMessage({
            type: "RECORD_ACTION",
            payload: {
              label: `Swapped to: ${targetName.slice(0, 50)}`,
              site: SITE,
              creditDelta: Math.abs(result.credit_delta),
              co2Kg: result.alternative_co2_kg,
              analogy: result.analogy,
              category: "ecommerce"
            }
          });
        },
        onDismiss: (reason) => {
          active = false;
          if (reason === "proceeded") {
            chrome.runtime.sendMessage({
              type: "RECORD_ACTION",
              payload: {
                label: `Bought: ${title.slice(0, 50)}`,
                site: SITE,
                creditDelta: result.credit_delta,
                co2Kg: result.co2_kg,
                analogy: result.analogy,
                category: "ecommerce"
              }
            });
          }
        }
      });
    });
  }

  // ── Trigger ────────────────────────────────────────────────────────────────

  function isProductPage() {
    const p = location.pathname;
    return /\/dp\/|\/p\/|product\/|item\//i.test(p)
      || (SITE === "flipkart" && /\/p\//i.test(p))
      || (SITE === "myntra"   && /\/buy\//i.test(p));
  }

  if (isProductPage()) {
    setTimeout(analyze, INITIAL_DELAY_MS);
    document.addEventListener("click", (e) => {
      for (const s of SELECTORS[SITE].addCart) {
        try { if (e.target.closest(s)) { setTimeout(analyze, CLICK_DELAY_MS); break; } } catch {}
      }
    }, true);
  }

  let lastURL = location.href;
  const ecommerceObserver = new MutationObserver(() => {
    if (location.href !== lastURL) {
      lastURL = location.href; lastKey = null; active = false;
      if (isProductPage()) setTimeout(analyze, DEBOUNCE_DELAY_MS);
    }
  });

  if (document.body) {
    ecommerceObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("pagehide", () => ecommerceObserver.disconnect(), { once: true });

})();
