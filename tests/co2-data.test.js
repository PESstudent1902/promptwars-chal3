/**
 * co2-data.test.js — Unit tests for local CO2 reference database and validation
 */

import { lookupCO2, validateCO2, isSustainableProduct } from "../src/utils/co2-data.js";

describe("co2-data utils", () => {
  describe("lookupCO2", () => {
    test("finds exact or regex matches for common terms", () => {
      const laptop = lookupCO2("Dell Latitude Laptop");
      expect(laptop).not.toBeNull();
      expect(laptop.key).toBe("laptop");
      expect(laptop.co2_kg).toBe(350);

      const phone = lookupCO2("Refurbished iPhone 13");
      expect(phone).not.toBeNull();
      expect(phone.key).toBe("refurbished phone");
      expect(phone.co2_kg).toBe(16);
    });

    test("is case-insensitive", () => {
      const mutton = lookupCO2("MUTTON BIRYANI");
      expect(mutton).not.toBeNull();
      expect(mutton.key).toBe("lamb");
    });

    test("returns null for unknown items", () => {
      expect(lookupCO2("a random unknown string")).toBeNull();
    });

    test("handles null or undefined inputs gracefully", () => {
      expect(lookupCO2(null)).toBeNull();
      expect(lookupCO2(undefined)).toBeNull();
      expect(lookupCO2(123)).toBeNull();
    });
  });

  describe("validateCO2", () => {
    test("passes through co2 values within deviation factor", () => {
      // Laptop reference is 350. Range is [70, 1750]
      const res = validateCO2(300, "Dell Laptop");
      expect(res.co2_kg).toBe(300);
      expect(res.clamped).toBe(false);
    });

    test("clamps value to reference if it exceeds maximum limit", () => {
      // Laptop reference is 350. Max limit is 1750. 2000 is > 1750
      const res = validateCO2(2000, "Dell Laptop");
      expect(res.co2_kg).toBe(350);
      expect(res.clamped).toBe(true);
    });

    test("clamps value to reference if it is below minimum limit", () => {
      // Laptop reference is 350. Min limit is 70. 50 is < 70
      const res = validateCO2(50, "Dell Laptop");
      expect(res.co2_kg).toBe(350);
      expect(res.clamped).toBe(true);
    });

    test("returns original value if product has no reference data", () => {
      const res = validateCO2(150, "Unknown Product");
      expect(res.co2_kg).toBe(150);
      expect(res.clamped).toBe(false);
    });

    test("handles non-number inputs by returning 0", () => {
      const res = validateCO2("invalid", "Dell Laptop");
      expect(res.co2_kg).toBe(0);
      expect(res.clamped).toBe(false);
    });
  });

  describe("isSustainableProduct", () => {
    test("detects sustainable keywords", () => {
      expect(isSustainableProduct("Organic Cotton T-Shirt")).toBe(true);
      expect(isSustainableProduct("Bamboo toothbrush")).toBe(true);
      expect(isSustainableProduct("Refurbished MacBook Air")).toBe(true);
      expect(isSustainableProduct("Jute door mat")).toBe(true);
    });

    test("returns false for standard non-sustainable products", () => {
      expect(isSustainableProduct("Polyester Shirt")).toBe(false);
      expect(isSustainableProduct("Plastic Water Bottle")).toBe(false);
    });

    test("handles null or undefined inputs gracefully", () => {
      expect(isSustainableProduct(null)).toBe(false);
      expect(isSustainableProduct(undefined)).toBe(false);
    });
  });
});
