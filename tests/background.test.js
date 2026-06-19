/**
 * background.test.js — Unit tests for background service worker routing and security checks
 */

let messageListener = null;

// Mock Chrome Extension API before importing background.js
global.chrome = {
  runtime: {
    onMessage: {
      addListener: (callback) => {
        messageListener = callback;
      }
    },
    onInstalled: {
      addListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn()
    },
    lastError: null
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn()
  },
  notifications: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  }
};

// Mock dependencies of background.js
jest.mock("../src/utils/gemini.js", () => ({
  analyzeCarbon: jest.fn().mockImplementation((payload) => Promise.resolve({
    co2_kg: 1.5,
    severity: "medium",
    itemName: payload.itemName
  }))
}));

jest.mock("../src/utils/score.js", () => ({
  recordAction: jest.fn().mockImplementation((payload) => Promise.resolve({
    newTotal: 600,
    streak: 3,
    delta: payload.creditDelta || 0
  })),
  getScoreState: jest.fn().mockResolvedValue({ total: 500, history: [] }),
  getMonthlySummary: jest.fn().mockResolvedValue({ greened: 2, saved_kg: 4.5, topCategory: "food", totalActions: 5 }),
  saveUser: jest.fn().mockResolvedValue()
}));

// Import background.js to trigger listener registration
require("../src/background/background.js");

describe("background.js service worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to trigger message listener and wait for async handlers to finish
  async function callListener(message, sender = {}) {
    const sendResponse = jest.fn();
    messageListener(message, sender, sendResponse);
    await new Promise(resolve => process.nextTick(resolve));
    return sendResponse;
  }

  describe("Message Routing & Input Validation", () => {
    test("rejects invalid message types", async () => {
      const sendResponse = await callListener({ type: "INVALID_TYPE" });
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: "Invalid message type"
      }));
    });

    test("routes and validates ANALYZE_ACTION", async () => {
      const payload = { itemName: "Paneer Tikka", category: "food", quantity: 1 };
      const sendResponse = await callListener({ type: "ANALYZE_ACTION", payload });
      
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        co2_kg: 1.5,
        severity: "medium"
      }));
    });

    test("ANALYZE_ACTION validation rejects empty itemName", async () => {
      const payload = { itemName: "", category: "food" };
      const sendResponse = await callListener({ type: "ANALYZE_ACTION", payload });

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: "Invalid payload: itemName must be a non-empty string"
      }));
    });

    test("ANALYZE_ACTION validation rejects invalid category", async () => {
      const payload = { itemName: "Paneer", category: "invalid_category" };
      const sendResponse = await callListener({ type: "ANALYZE_ACTION", payload });

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: "Invalid payload: category must be food, cab, ecommerce, or travel"
      }));
    });

    test("routes and validates RECORD_ACTION", async () => {
      const payload = { label: "Bought paneer", category: "food", creditDelta: 10, co2Kg: 0.5 };
      const sendResponse = await callListener({ type: "RECORD_ACTION", payload });

      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        newTotal: 600,
        streak: 3
      }));
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "600" });
    });
  });

  describe("SSRF Checks inside handleFetchHtml", () => {
    test("allows fetch for allowlisted origins", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: () => "50"
        },
        text: () => Promise.resolve("<html>allowed content</html>")
      });

      const sendResponse = await callListener({ type: "FETCH_HTML", payload: { url: "https://amazon.in/dp/123" } });
      expect(sendResponse).toHaveBeenCalledWith("<html>allowed content</html>");
    });

    test("blocks fetch for non-allowlisted origins", async () => {
      const sendResponse = await callListener({ type: "FETCH_HTML", payload: { url: "https://malicious.com" } });
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: "FETCH_BLOCKED"
      }));
    });

    test("blocks fetch for non-HTTPS protocols", async () => {
      const sendResponse = await callListener({ type: "FETCH_HTML", payload: { url: "http://amazon.in/dp/123" } });
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        error: "FETCH_BLOCKED"
      }));
    });
  });

  describe("Analysis Debounce States", () => {
    test("returns debounced status on rapid subsequent calls for same item", async () => {
      const payload = { itemName: "Ola Electric Cab", category: "cab", quantity: 1 };

      // Call 1 (normal)
      const sendResponse1 = await callListener({ type: "ANALYZE_ACTION", payload });
      expect(sendResponse1).not.toHaveBeenCalledWith(expect.objectContaining({ debounced: true }));

      // Call 2 (within cooldown)
      const sendResponse2 = await callListener({ type: "ANALYZE_ACTION", payload });
      expect(sendResponse2).toHaveBeenCalledWith({ debounced: true });
    });
  });
});
