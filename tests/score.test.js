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

import {
  getTier,
  getDeltaMessage,
  clampScore,
  trimHistory,
  updateStreak,
  getMonthlySummaryFromHistory
} from "../src/utils/score.js";

// ─── getTier tests ────────────────────────────────────────────────────────────

describe("getTier", () => {
  test("returns EcoChampion for 800+", () => {
    expect(getTier(800).label).toBe("EcoChampion");
    expect(getTier(9999).label).toBe("EcoChampion");
  });

  test("returns GreenMover for 650-799", () => {
    expect(getTier(650).label).toBe("GreenMover");
    expect(getTier(799).label).toBe("GreenMover");
  });

  test("returns Aware for 500-649", () => {
    expect(getTier(500).label).toBe("Aware");
    expect(getTier(649).label).toBe("Aware");
  });

  test("returns Learning for 350-499", () => {
    expect(getTier(350).label).toBe("Learning");
    expect(getTier(499).label).toBe("Learning");
  });

  test("returns Starting Out below 350", () => {
    expect(getTier(349).label).toBe("Starting Out");
    expect(getTier(0).label).toBe("Starting Out");
  });

  test("each tier has an emoji", () => {
    [0, 350, 500, 650, 800].forEach((score) => {
      expect(getTier(score).emoji).toBeTruthy();
    });
  });

  test("exact boundary: 500 is Aware not Learning", () => {
    expect(getTier(500).label).toBe("Aware");
    expect(getTier(499).label).toBe("Learning");
  });
});

// ─── getDeltaMessage tests ────────────────────────────────────────────────────

describe("getDeltaMessage", () => {
  test("huge win for 20+", () => {
    expect(getDeltaMessage(20)).toBe("Huge green win! 🌿");
    expect(getDeltaMessage(30)).toBe("Huge green win! 🌿");
  });

  test("nice choice for 10-19", () => {
    expect(getDeltaMessage(10)).toBe("Nice choice for the planet.");
    expect(getDeltaMessage(15)).toBe("Nice choice for the planet.");
  });

  test("every bit counts for 1-9", () => {
    expect(getDeltaMessage(1)).toBe("Every bit counts.");
    expect(getDeltaMessage(9)).toBe("Every bit counts.");
  });

  test("no change for 0", () => {
    expect(getDeltaMessage(0)).toBe("Noted. No change.");
  });

  test("small cost for -1 to -10", () => {
    expect(getDeltaMessage(-1)).toBe("Small carbon cost.");
    expect(getDeltaMessage(-10)).toBe("Small carbon cost.");
  });

  test("high impact for -11 to -30", () => {
    expect(getDeltaMessage(-11)).toBe("High impact choice.");
    expect(getDeltaMessage(-30)).toBe("High impact choice.");
  });

  test("heavy footprint for -31 and below", () => {
    expect(getDeltaMessage(-31)).toBe("Heavy carbon footprint.");
    expect(getDeltaMessage(-60)).toBe("Heavy carbon footprint.");
  });
});

// ─── clampScore tests ─────────────────────────────────────────────────────────

describe("clampScore", () => {
  test("adds positive delta", () => {
    expect(clampScore(500, 20)).toBe(520);
  });

  test("subtracts negative delta", () => {
    expect(clampScore(500, -15)).toBe(485);
  });

  test("floors at 0", () => {
    expect(clampScore(10, -50)).toBe(0);
    expect(clampScore(0, -1)).toBe(0);
  });

  test("caps at 9999", () => {
    expect(clampScore(9990, 100)).toBe(9999);
  });
});

// ─── trimHistory tests ────────────────────────────────────────────────────────

describe("trimHistory", () => {
  test("trims to max", () => {
    const h = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    expect(trimHistory(h, 50).length).toBe(50);
  });

  test("keeps first entries", () => {
    const h = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    expect(trimHistory(h, 50)[0].id).toBe(0);
  });

  test("does not trim if under limit", () => {
    const h = [{ id: 1 }, { id: 2 }];
    expect(trimHistory(h, 50).length).toBe(2);
  });

  test("empty array stays empty", () => {
    expect(trimHistory([], 50)).toEqual([]);
  });
});

// ─── updateStreak tests ───────────────────────────────────────────────────────

describe("updateStreak", () => {
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toDateString();
  const today = new Date().toDateString();

  test("negative delta does not extend streak", () => {
    expect(updateStreak(5, yesterday, -10)).toBe(5);
  });

  test("same day does not increase streak", () => {
    expect(updateStreak(5, today, 10)).toBe(5);
  });

  test("consecutive day extends streak", () => {
    expect(updateStreak(5, yesterday, 10)).toBe(6);
  });

  test("gap resets streak to 1", () => {
    expect(updateStreak(5, twoDaysAgo, 10)).toBe(1);
  });

  test("first ever action starts streak at 1", () => {
    expect(updateStreak(0, null, 10)).toBe(1);
  });
});

// ─── getMonthlySummary tests ──────────────────────────────────────────────────

describe("getMonthlySummaryFromHistory", () => {
  const now = new Date();
  const thisMonth = now.toISOString();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 5).toISOString();

  const history = [
    { delta: 20, co2Kg: 0.4, savingKg: 1.5, category: "food",      timestamp: thisMonth },
    { delta: 15, co2Kg: 0.3, savingKg: 1.0, category: "cab",        timestamp: thisMonth },
    { delta: -12, co2Kg: 1.8, category: "food",      timestamp: thisMonth },
    { delta: 25, co2Kg: 0.03, savingKg: 0.1, category: "transport", timestamp: thisMonth },
    { delta: 10, co2Kg: 0.5, savingKg: 0.8, category: "food",       timestamp: lastMonth },
  ];

  const summary = getMonthlySummaryFromHistory(history);

  test("counts only this month's green actions", () => {
    expect(summary.greened).toBe(3);
  });

  test("CO2 saved is positive", () => {
    expect(summary.saved_kg).toBeGreaterThan(0);
  });

  test("excludes last month from total count", () => {
    expect(summary.totalActions).toBe(4);
  });

  test("identifies top category", () => {
    expect(summary.topCategory).toBe("food");
  });

  test("handles empty history", () => {
    const empty = getMonthlySummaryFromHistory([]);
    expect(empty.greened).toBe(0);
    expect(empty.saved_kg).toBe(0);
    expect(empty.topCategory).toBe("—");
  });
});
