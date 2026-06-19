/**
 * dom-mock.test.js — DOM simulation tests for content scripts
 *
 * Simulates the key detection logic from content-food.js and
 * content-cab.js against mock DOM structures representing
 * Zomato, Swiggy, Ola, and Uber checkout pages.
 */

// ─── Food detection helpers (extracted from content-food.js) ──────────────────

function inferFoodCategory(name) {
  const lower = name.toLowerCase();
  if (/beef|mutton|lamb|goat/.test(lower)) return "red meat";
  if (/chicken|egg|prawn|fish|seafood|crab/.test(lower)) return "non-veg";
  if (/burger|pizza|fries|nugget/.test(lower)) return "fast food";
  if (/dal|sabzi|roti|rice|idli|dosa/.test(lower)) return "vegetarian";
  if (/salad|quinoa|oat|smoothie/.test(lower)) return "healthy";
  if (/biryani|pulao/.test(lower)) return "rice dish";
  return "food";
}

function prioritizeItems(items) {
  return items.find((i) => /beef|mutton|lamb|chicken|prawn/i.test(i)) || items[items.length - 1];
}

function deduplicateItems(items) {
  return [...new Set(items)];
}

// ─── Cab detection helpers (extracted from content-cab.js) ────────────────────

function classifyRide(text) {
  const lower = (text || "").toLowerCase();
  if (/share|pool|carpool|shared/i.test(lower)) return { type: "shared", isGreen: true };
  if (/electric|ev|e-rickshaw|blusmart/i.test(lower)) return { type: "ev", isGreen: true };
  if (/auto|e-auto/.test(lower)) return { type: "auto", isGreen: false };
  if (/bike|moto|scooter/i.test(lower)) return { type: "bike", isGreen: true };
  return { type: "solo", isGreen: false };
}

function parseDistance(text) {
  const match = (text || "").match(/([\d.]+)\s*km/i);
  return match ? parseFloat(match[1]) : 5;
}

// ─── Travel helpers ───────────────────────────────────────────────────────────

function cityCode(cityName) {
  const map = {
    "delhi": "del", "new delhi": "del",
    "mumbai": "mum", "bombay": "mum",
    "bangalore": "blr", "bengaluru": "blr",
    "hyderabad": "hyd",
    "kolkata": "kol",
    "chennai": "chn",
  };
  const lower = (cityName || "").toLowerCase();
  for (const [key, code] of Object.entries(map)) {
    if (lower.includes(key)) return code;
  }
  return lower.slice(0, 3);
}

// ─── E-commerce helpers (extracted from content-ecommerce.js) ──────────────────

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

// ─── DOM simulation helpers ───────────────────────────────────────────────────

function createMockDOM(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

function getTextFromSelectors(root, selectors) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el.textContent.trim();
    } catch { /* skip */ }
  }
  return "";
}

// ─── inferFoodCategory ───────────────────────────────────────────────────────

describe("inferFoodCategory", () => {
  test("detects red meat", () => {
    expect(inferFoodCategory("Mutton Biryani")).toBe("red meat");
    expect(inferFoodCategory("Beef Burger")).toBe("red meat");
    expect(inferFoodCategory("Lamb Curry")).toBe("red meat");
  });

  test("detects non-veg", () => {
    expect(inferFoodCategory("Chicken Tikka")).toBe("non-veg");
    expect(inferFoodCategory("Prawn Masala")).toBe("non-veg");
    expect(inferFoodCategory("Fish Fry")).toBe("non-veg");
  });

  test("detects fast food", () => {
    expect(inferFoodCategory("Burger with Fries")).toBe("fast food");
    expect(inferFoodCategory("Margherita Pizza")).toBe("fast food");
  });

  test("detects vegetarian", () => {
    expect(inferFoodCategory("Dal Makhani")).toBe("vegetarian");
    expect(inferFoodCategory("Masala Dosa")).toBe("vegetarian");
    expect(inferFoodCategory("Paneer Roti")).toBe("vegetarian");
  });

  test("detects healthy", () => {
    expect(inferFoodCategory("Oat Smoothie")).toBe("healthy");
    expect(inferFoodCategory("Quinoa Salad")).toBe("healthy");
  });

  test("defaults to food for unknown items", () => {
    expect(inferFoodCategory("Pav Bhaji")).toBe("food");
    expect(inferFoodCategory("Mystery Item")).toBe("food");
  });

  test("case insensitive", () => {
    expect(inferFoodCategory("CHICKEN BIRYANI")).toBe("non-veg");
    expect(inferFoodCategory("dal makhani")).toBe("vegetarian");
  });
});

// ─── prioritizeItems ─────────────────────────────────────────────────────────

describe("prioritizeItems", () => {
  test("prefers high-carbon meat items", () => {
    const items = ["Dal Makhani", "Chicken Burger", "Veg Sandwich"];
    expect(prioritizeItems(items)).toBe("Chicken Burger");
  });

  test("prefers mutton over chicken", () => {
    const items = ["Mutton Curry", "Chicken Biryani", "Dal Fry"];
    expect(prioritizeItems(items)).toBe("Mutton Curry");
  });

  test("falls back to last item if no meat", () => {
    const items = ["Dal Makhani", "Paneer Tikka", "Naan"];
    expect(prioritizeItems(items)).toBe("Naan");
  });

  test("handles single item", () => {
    expect(prioritizeItems(["Idli Sambar"])).toBe("Idli Sambar");
  });
});

// ─── deduplicateItems ────────────────────────────────────────────────────────

describe("deduplicateItems", () => {
  test("removes duplicates", () => {
    const items = ["Dal", "Roti", "Dal", "Rice", "Roti"];
    expect(deduplicateItems(items)).toEqual(["Dal", "Roti", "Rice"]);
  });

  test("empty array stays empty", () => {
    expect(deduplicateItems([])).toEqual([]);
  });

  test("single item array unchanged", () => {
    expect(deduplicateItems(["Biryani"])).toEqual(["Biryani"]);
  });
});

// ─── classifyRide ────────────────────────────────────────────────────────────

describe("classifyRide", () => {
  test("detects shared rides as green", () => {
    expect(classifyRide("Ola Share").isGreen).toBe(true);
    expect(classifyRide("Uber Pool").isGreen).toBe(true);
    expect(classifyRide("Carpool").isGreen).toBe(true);
  });

  test("detects EV as green", () => {
    expect(classifyRide("BluSmart Electric").isGreen).toBe(true);
    expect(classifyRide("EV Cab").isGreen).toBe(true);
  });

  test("detects solo as not green", () => {
    expect(classifyRide("Ola Mini").isGreen).toBe(false);
    expect(classifyRide("Uber Go").isGreen).toBe(false);
    expect(classifyRide("Premier").isGreen).toBe(false);
  });

  test("detects bike as green", () => {
    expect(classifyRide("Rapido Bike").isGreen).toBe(true);
    expect(classifyRide("Moto").isGreen).toBe(true);
  });

  test("detects auto as not green", () => {
    expect(classifyRide("Auto").isGreen).toBe(false);
  });

  test("handles empty string", () => {
    expect(classifyRide("").type).toBe("solo");
  });

  test("handles null/undefined", () => {
    expect(classifyRide(null).type).toBe("solo");
    expect(classifyRide(undefined).type).toBe("solo");
  });
});

// ─── parseDistance ────────────────────────────────────────────────────────────

describe("parseDistance", () => {
  test("parses simple distance", () => {
    expect(parseDistance("4.2 km")).toBe(4.2);
  });

  test("parses distance with no space", () => {
    expect(parseDistance("7.5km")).toBe(7.5);
  });

  test("parses integer distance", () => {
    expect(parseDistance("10 km")).toBe(10);
  });

  test("returns default 5 for unrecognized format", () => {
    expect(parseDistance("unknown")).toBe(5);
    expect(parseDistance("")).toBe(5);
    expect(parseDistance(null)).toBe(5);
  });

  test("handles Estimated 3.4 km text", () => {
    expect(parseDistance("Estimated 3.4 km away")).toBe(3.4);
  });
});

// ─── cityCode ────────────────────────────────────────────────────────────────

describe("cityCode", () => {
  test("maps major cities", () => {
    expect(cityCode("Mumbai")).toBe("mum");
    expect(cityCode("Delhi")).toBe("del");
    expect(cityCode("Bangalore")).toBe("blr");
    expect(cityCode("Bengaluru")).toBe("blr");
    expect(cityCode("Hyderabad")).toBe("hyd");
    expect(cityCode("Chennai")).toBe("chn");
    expect(cityCode("Kolkata")).toBe("kol");
  });

  test("case insensitive", () => {
    expect(cityCode("MUMBAI")).toBe("mum");
    expect(cityCode("new delhi")).toBe("del");
  });

  test("falls back to first 3 chars for unknown city", () => {
    expect(cityCode("Pune")).toBe("pun");
    expect(cityCode("Ahmedabad")).toBe("ahm");
  });

  test("handles empty/null", () => {
    expect(cityCode("")).toBe("");
    expect(cityCode(null)).toBe("");
  });
});

// ─── DOM simulation — Zomato cart ────────────────────────────────────────────

describe("Zomato cart DOM simulation", () => {
  const zomatoCartHTML = `
    <div class="cart-wrapper">
      <div data-testid="cart-item-name">Chicken Biryani</div>
      <div data-testid="cart-item-name">Dal Tadka</div>
      <div data-testid="cart-item-name">Butter Naan</div>
    </div>
  `;

  test("extracts cart items from Zomato DOM", () => {
    const root = createMockDOM(zomatoCartHTML);
    const items = [];
    root.querySelectorAll("[data-testid='cart-item-name']").forEach((el) => {
      const text = el.textContent?.trim();
      if (text) items.push(text);
    });
    expect(items).toEqual(["Chicken Biryani", "Dal Tadka", "Butter Naan"]);
  });

  test("prioritizes Chicken Biryani over Dal and Naan", () => {
    const items = ["Chicken Biryani", "Dal Tadka", "Butter Naan"];
    expect(prioritizeItems(items)).toBe("Chicken Biryani");
  });

  test("infers non-veg for Chicken Biryani", () => {
    expect(inferFoodCategory("Chicken Biryani")).toBe("non-veg");
  });
});

// ─── DOM simulation — Ola booking ────────────────────────────────────────────

describe("Ola booking DOM simulation", () => {
  const olaBookingHTML = `
    <div class="booking-page">
      <div data-testid="ride-category">Ola Share</div>
      <div data-testid="distance">Trip distance: 6.2 km</div>
      <button data-testid="book-ride-btn">Book Now</button>
    </div>
  `;

  test("extracts ride type from Ola DOM", () => {
    const root = createMockDOM(olaBookingHTML);
    const rideEl = root.querySelector("[data-testid='ride-category']");
    expect(rideEl?.textContent?.trim()).toBe("Ola Share");
  });

  test("classifies Ola Share as green", () => {
    const { isGreen, type } = classifyRide("Ola Share");
    expect(isGreen).toBe(true);
    expect(type).toBe("shared");
  });

  test("parses 6.2 km from distance text", () => {
    expect(parseDistance("Trip distance: 6.2 km")).toBe(6.2);
  });
});

// ─── DOM simulation — Flight booking ─────────────────────────────────────────

describe("MakeMyTrip flight DOM simulation", () => {
  const flightHTML = `
    <div class="search-form">
      <div data-cy="fromCity">Mumbai</div>
      <div data-cy="toCity">Delhi</div>
      <div class="flight-results">
        <div class="airline">IndiGo</div>
      </div>
    </div>
  `;

  test("extracts origin and destination", () => {
    const root = createMockDOM(flightHTML);
    const origin = root.querySelector("[data-cy='fromCity']")?.textContent?.trim();
    const dest   = root.querySelector("[data-cy='toCity']")?.textContent?.trim();
    expect(origin).toBe("Mumbai");
    expect(dest).toBe("Delhi");
  });

  test("maps to correct city codes", () => {
    expect(cityCode("Mumbai")).toBe("mum");
    expect(cityCode("Delhi")).toBe("del");
  });
});

// ─── E-commerce helper tests ──────────────────────────────────────────────────

function buildGreenSearchUrlForTesting(title, site) {
  const lower = title.toLowerCase();
  let query = "";

  if (/\b(plastic|disposable|single-use)\b/i.test(lower)) {
    query = title.replace(/\b(plastic|disposable|single-use)\b/gi, "").trim() + " bamboo eco";
  } else if (/\b(polyester|nylon|synthetic)\b/i.test(lower)) {
    query = title.replace(/\b(polyester|nylon|synthetic)\b/gi, "").trim() + " organic cotton";
  } else if (/\b(laptop|phone|smartphone|iphone)\b/i.test(lower)) {
    query = "refurbished " + title.split(" ").slice(0, 3).join(" ");
  } else if (/\b(shirt|tshirt|t-shirt|jeans|dress|kurta)\b/i.test(lower)) {
    query = title.split(" ").slice(0, 3).join(" ") + " organic sustainable";
  } else if (/\b(bottle|container|bag)\b/i.test(lower)) {
    query = title.split(" ").slice(0, 3).join(" ") + " reusable stainless";
  } else {
    query = title.split(" ").slice(0, 4).join(" ") + " eco friendly";
  }

  query = query.trim();
  let searchUrl = "";

  if (site === "amazon") {
    searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
  } else if (site === "flipkart") {
    searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  } else if (site === "myntra") {
    searchUrl = `https://www.myntra.com/${encodeURIComponent(query.replace(/\s+/g, "-"))}`;
  }

  return { searchUrl, searchQuery: query };
}

describe("E-commerce search URL builder", () => {
  test("generates bamboo/eco queries for plastic/disposable items", () => {
    const res = buildGreenSearchUrlForTesting("Plastic Water Bottle 1L", "amazon");
    expect(res.searchQuery).toContain("bamboo eco");
    expect(res.searchUrl).toContain("https://www.amazon.in/s?k=");
  });

  test("generates organic cotton queries for synthetic/polyester items", () => {
    const res = buildGreenSearchUrlForTesting("Polyester Slim Fit T-Shirt", "myntra");
    expect(res.searchQuery).toContain("organic cotton");
    expect(res.searchUrl).toContain("https://www.myntra.com/");
  });

  test("generates refurbished queries for electronics", () => {
    const res = buildGreenSearchUrlForTesting("iPhone 15 Pro Max 256GB", "flipkart");
    expect(res.searchQuery).toContain("refurbished");
  });
});

describe("E-commerce DOM extraction & parsing simulation", () => {
  test("extracts original product image from Amazon mock DOM", () => {
    const amazonHTML = `
      <div id="imageBlock">
        <img id="landingImage" src="https://images-amazon.com/original-bottle.jpg" />
      </div>
    `;
    const root = createMockDOM(amazonHTML);
    const imgEl = root.querySelector("#landingImage");
    expect(imgEl?.getAttribute("src")).toBe("https://images-amazon.com/original-bottle.jpg");
  });

  test("parses first search result from Amazon search results mock DOM", () => {
    const searchResultsHTML = `
      <div class="s-main-slot">
        <div data-component-type="s-search-result">
          <div class="puis-sponsored-label-text">Sponsored</div>
          <h2><a href="/sponsored-item"><span>Sponsored Bamboo Bottle</span></a></h2>
          <img class="s-image" src="sponsored.jpg" />
        </div>
        <div data-component-type="s-search-result">
          <h2><a class="a-link-normal" href="/eco-friendly-bamboo-bottle"><span>Premium Eco Bamboo Bottle</span></a></h2>
          <img class="s-image" src="bamboo-bottle.jpg" />
        </div>
      </div>
    `;
    const root = createMockDOM(searchResultsHTML);
    const items = root.querySelectorAll('div[data-component-type="s-search-result"]');
    
    let parsedProduct = null;
    for (const item of items) {
      const isSponsored = item.textContent.toLowerCase().includes("sponsored");
      const titleEl = item.querySelector('h2 a span');
      const linkEl = item.querySelector('h2 a');
      const imgEl = item.querySelector('img.s-image');
      
      if (titleEl && linkEl && imgEl) {
        parsedProduct = {
          title: titleEl.textContent.trim(),
          url: "https://www.amazon.in" + linkEl.getAttribute("href"),
          img: imgEl.getAttribute("src"),
        };
        if (!isSponsored) break;
      }
    }

    expect(parsedProduct).not.toBeNull();
    expect(parsedProduct.title).toBe("Premium Eco Bamboo Bottle");
    expect(parsedProduct.url).toBe("https://www.amazon.in/eco-friendly-bamboo-bottle");
    expect(parsedProduct.img).toBe("bamboo-bottle.jpg");
  });

  describe("classify (e-commerce)", () => {
    test("classifies laptop/PC", () => {
      expect(classify("MacBook Air M1", "electronics").cat).toBe("laptop/PC");
      expect(classify("gaming pc computer", "tech").cat).toBe("laptop/PC");
    });

    test("classifies ipad as tablet instead of smartphone", () => {
      expect(classify("Apple iPad Pro 11-inch", "electronics").cat).toBe("tablet");
    });

    test("classifies smartphone", () => {
      expect(classify("Samsung Galaxy S23 Ultra", "mobile").cat).toBe("smartphone");
    });

    test("classifies synthetic clothing", () => {
      expect(classify("Polyester t-shirt", "apparel").cat).toBe("synthetic clothing");
    });

    test("classifies sustainable clothing", () => {
      expect(classify("Organic Cotton shirt", "fashion").cat).toBe("sustainable clothing");
    });

    test("classifies sustainable option if sustainable keyword matches", () => {
      const res = classify("Bamboo door mat", "home decor");
      expect(res.sev).toBe("low");
      expect(res.score).toBeGreaterThan(0);
    });
  });
});
