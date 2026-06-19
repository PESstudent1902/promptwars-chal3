/**
 * security.test.js — Unit tests for EcoScore security and input validation functions
 */

// Mock Chrome API
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
    }
  }
};

// We test the format check directly from the gemini utility file
import { isValidApiKeyFormat } from "../src/utils/gemini.js";

import { sanitize, parseGeminiResponse, buildCacheKey } from "../src/utils/gemini.js";

// Local copies/mocks of functions that aren't exported or are environment-dependent
const ALLOWED_FETCH_HOSTNAMES = new Set([
  "www.amazon.in",
  "amazon.in",
  "www.flipkart.com",
  "flipkart.com",
  "www.myntra.com",
  "myntra.com",
]);

function validateFetchUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") {
    return { ok: false, reason: "Missing or non-string URL" };
  }
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only HTTPS URLs are permitted" };
  }
  if (!ALLOWED_FETCH_HOSTNAMES.has(parsed.hostname)) {
    return { ok: false, reason: "Domain not in fetch allowlist" };
  }
  return { ok: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Security Hardening & Input Validation", () => {
  describe("sanitize() - XSS & Prompt Injection Prevention", () => {
    test("strips script tags and html characters", () => {
      expect(sanitize("<script>alert('xss')</script>")).toBe("scriptalert(xss)/script");
      expect(sanitize("<div style='background: red'>")).toBe("div style=background: red");
    });

    test("strips control characters", () => {
      expect(sanitize("hello\x00world\x1f")).toBe("helloworld");
    });

    test("strips backticks and quotes", () => {
      expect(sanitize("`test` 'value' \"name\"")).toBe("test value name");
    });

    test("returns empty string for non-strings", () => {
      expect(sanitize(123)).toBe("");
      expect(sanitize(null)).toBe("");
    });
  });

  describe("isValidApiKeyFormat() - Format Guard", () => {
    test("allows valid google api key pattern", () => {
      expect(isValidApiKeyFormat("AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q")).toBe(true);
    });

    test("rejects malformed keys", () => {
      expect(isValidApiKeyFormat("A1zaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q")).toBe(false);
      expect(isValidApiKeyFormat("AIza")).toBe(false);
      expect(isValidApiKeyFormat("AIzaSyA1B 2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q")).toBe(false);
      expect(isValidApiKeyFormat(null)).toBe(false);
    });
  });

  describe("validateFetchUrl() - SSRF Prevention Allowlist", () => {
    test("allows allowlisted origins over HTTPS", () => {
      expect(validateFetchUrl("https://amazon.in/dp/123456").ok).toBe(true);
      expect(validateFetchUrl("https://www.flipkart.com/p/abc").ok).toBe(true);
      expect(validateFetchUrl("https://myntra.com/buy/xyz").ok).toBe(true);
    });

    test("rejects non-HTTPS protocols", () => {
      expect(validateFetchUrl("http://amazon.in/dp/123456").ok).toBe(false);
      expect(validateFetchUrl("ftp://amazon.in/dp/123456").ok).toBe(false);
    });

    test("rejects internal and local addresses", () => {
      expect(validateFetchUrl("https://localhost:8080/").ok).toBe(false);
      expect(validateFetchUrl("https://127.0.0.1/").ok).toBe(false);
      expect(validateFetchUrl("https://192.168.1.1/").ok).toBe(false);
      expect(validateFetchUrl("file:///etc/passwd").ok).toBe(false);
    });

    test("rejects arbitrary domains", () => {
      expect(validateFetchUrl("https://google.com/").ok).toBe(false);
      expect(validateFetchUrl("https://malicious-site.com/").ok).toBe(false);
    });
  });

  describe("parseGeminiResponse() - Malformed JSON & Severity Guard", () => {
    const validJson = `{
      "co2_kg": 1.2,
      "severity": "low",
      "analogy": "ceiling fan",
      "credit_delta": 10,
      "current_pros": ["pro"],
      "current_cons": ["con"],
      "alternative_name": "Bamboo",
      "alternative_co2_kg": 0.2,
      "alternative_pros": ["alt pro"],
      "alternative_cons": ["alt con"],
      "saving_kg": 1.0,
      "saving_message": "switched!"
    }`;

    test("parses valid JSON with markdown fences", () => {
      const raw = "```json\n" + validJson + "\n```";
      const parsed = parseGeminiResponse(raw);
      expect(parsed.co2_kg).toBe(1.2);
      expect(parsed.severity).toBe("low");
    });

    test("clamps unknown severity to medium default", () => {
      const invalidSeverity = validJson.replace('"severity": "low"', '"severity": "extreme"');
      const parsed = parseGeminiResponse(invalidSeverity);
      expect(parsed.severity).toBe("medium");
    });

    test("clamps numeric ranges correctly", () => {
      const invalidNumbers = validJson
        .replace('"credit_delta": 10', '"credit_delta": 150')
        .replace('"co2_kg": 1.2', '"co2_kg": -5');
      const parsed = parseGeminiResponse(invalidNumbers);
      expect(parsed.credit_delta).toBe(30);
      expect(parsed.co2_kg).toBe(0);
    });

    test("throws error if required fields are missing", () => {
      const missingField = validJson.replace('"analogy": "ceiling fan",', '');
      expect(() => parseGeminiResponse(missingField)).toThrow();
    });
  });

  describe("buildCacheKey() - Uniqueness and collision resistance", () => {
    test("includes category to prevent cross-category collision", () => {
      const key1 = buildCacheKey("Item Name", "food");
      const key2 = buildCacheKey("Item Name", "cab");
      expect(key1).not.toBe(key2);
    });
  });
});
