import {
  sanitizeForPrompt,
  clampCreditDelta,
  validateCarbonResult,
  parseCarbonResponse,
  buildCacheKey
} from "../src/utils/gemini.js";

// ─── sanitizeForPrompt ────────────────────────────────────────────────────────

describe("sanitizeForPrompt", () => {
  test("strips control characters", () => {
    expect(sanitizeForPrompt("hello\x00world\x1F")).toBe("helloworld");
  });

  test("strips HTML injection characters", () => {
    expect(sanitizeForPrompt('<script>alert("xss")</script>')).toBe("scriptalert(xss)/script");
  });

  test("strips backticks", () => {
    expect(sanitizeForPrompt("item`name")).toBe("itemname");
  });

  test("truncates at 200 characters", () => {
    const long = "a".repeat(300);
    expect(sanitizeForPrompt(long).length).toBe(200);
  });

  test("trims whitespace", () => {
    expect(sanitizeForPrompt("  burger  ")).toBe("burger");
  });

  test("returns empty string for non-string input", () => {
    expect(sanitizeForPrompt(null)).toBe("");
    expect(sanitizeForPrompt(undefined)).toBe("");
    expect(sanitizeForPrompt(123)).toBe("");
  });

  test("allows normal food item names", () => {
    expect(sanitizeForPrompt("Chicken Biryani")).toBe("Chicken Biryani");
    expect(sanitizeForPrompt("Dal Makhani")).toBe("Dal Makhani");
  });

  test("handles empty string", () => {
    expect(sanitizeForPrompt("")).toBe("");
  });

  test("handles multiple consecutive control characters", () => {
    expect(sanitizeForPrompt("\x00\x01\x02abc\x03\x04")).toBe("abc");
  });
});

// ─── clampCreditDelta ─────────────────────────────────────────────────────────

describe("clampCreditDelta", () => {
  test("clamps to max +30", () => {
    expect(clampCreditDelta(100)).toBe(30);
    expect(clampCreditDelta(31)).toBe(30);
  });

  test("clamps to min -60", () => {
    expect(clampCreditDelta(-100)).toBe(-60);
    expect(clampCreditDelta(-61)).toBe(-60);
  });

  test("passes through values in range", () => {
    expect(clampCreditDelta(20)).toBe(20);
    expect(clampCreditDelta(-15)).toBe(-15);
    expect(clampCreditDelta(0)).toBe(0);
  });

  test("rounds float values", () => {
    expect(clampCreditDelta(14.7)).toBe(15);
    expect(clampCreditDelta(-5.3)).toBe(-5);
  });

  test("clamping boundary values", () => {
    expect(clampCreditDelta(-60)).toBe(-60);
    expect(clampCreditDelta(30)).toBe(30);
  });

  test("handles invalid inputs by returning 0", () => {
    expect(clampCreditDelta("not a number")).toBe(0);
    expect(clampCreditDelta(null)).toBe(0);
    expect(clampCreditDelta(undefined)).toBe(0);
  });
});

// ─── validateCarbonResult ─────────────────────────────────────────────────────

describe("validateCarbonResult", () => {
  const validResult = {
    co2_kg: 1.8,
    analogy: "That's like driving 9 km in a petrol car.",
    alternative_name: "Dal Makhani",
    alternative_co2_kg: 0.4,
    credit_delta: -12,
    saving_message: "Switching saves 1.4 kg CO2.",
    severity: "medium",
    current_pros: ["pro1"],
    current_cons: ["con1"],
    alternative_pros: ["altPro1"],
    alternative_cons: ["altCon1"],
    saving_kg: 1.4,
  };

  test("passes for a complete valid result", () => {
    expect(validateCarbonResult(validResult)).toBe(true);
  });

  test("throws for missing co2_kg", () => {
    const { co2_kg, ...incomplete } = validResult;
    expect(() => validateCarbonResult(incomplete)).toThrow("Missing field: co2_kg");
  });

  test("throws for missing analogy", () => {
    const { analogy, ...incomplete } = validResult;
    expect(() => validateCarbonResult(incomplete)).toThrow("Missing field: analogy");
  });

  test("throws for missing severity", () => {
    const { severity, ...incomplete } = validResult;
    expect(() => validateCarbonResult(incomplete)).toThrow("Missing field: severity");
  });

  test("allows zero values for numeric fields", () => {
    const withZero = { ...validResult, co2_kg: 0, alternative_co2_kg: 0 };
    expect(validateCarbonResult(withZero)).toBe(true);
  });
});

// ─── parseCarbonResponse ──────────────────────────────────────────────────────

describe("parseCarbonResponse", () => {
  test("parses clean JSON", () => {
    const raw = '{"co2_kg": 1.8, "severity": "medium"}';
    expect(parseCarbonResponse(raw)).toEqual({ co2_kg: 1.8, severity: "medium" });
  });

  test("strips markdown code fences", () => {
    const raw = "```json\n{\"co2_kg\": 1.8}\n```";
    expect(parseCarbonResponse(raw)).toEqual({ co2_kg: 1.8 });
  });

  test("strips code fence without language specifier", () => {
    const raw = "```\n{\"co2_kg\": 2.0}\n```";
    expect(parseCarbonResponse(raw)).toEqual({ co2_kg: 2.0 });
  });

  test("throws on malformed JSON", () => {
    expect(() => parseCarbonResponse("not json at all")).toThrow();
  });

  test("handles whitespace around JSON", () => {
    const raw = "   { \"co2_kg\": 0.5 }   ";
    expect(parseCarbonResponse(raw)).toEqual({ co2_kg: 0.5 });
  });
});

// ─── Cache key generation ─────────────────────────────────────────────────────

describe("cache key generation", () => {
  test("normalizes to lowercase", () => {
    expect(buildCacheKey("Chicken Biryani", "food")).toBe("food_chicken_biryani");
  });

  test("replaces spaces with underscores", () => {
    expect(buildCacheKey("Dal Makhani", "food")).toBe("food_dal_makhani");
  });

  test("same item always produces same key", () => {
    expect(buildCacheKey("Ola Mini", "cab")).toBe("cab_ola_mini");
  });

  test("different categories produce different keys", () => {
    expect(buildCacheKey("item", "food")).not.toBe(buildCacheKey("item", "cab"));
  });
});
