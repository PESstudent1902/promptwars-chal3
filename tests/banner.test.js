/**
 * banner.test.js — Integration tests for Shadow DOM banner injection, styling, and keyboard interactions
 * @jest-environment jsdom
 */

describe("EcoScoreUI Banner injection & interaction", () => {
  beforeAll(() => {
    // Load card-ui.js to populate window.EcoScoreUI and window.buildCardHTML / buildComingSoonCardHTML
    require("../src/content-scripts/card-ui.js");
  });

  beforeEach(() => {
    // Clean up DOM before each test
    document.getElementById("ecoscore-root")?.remove();
  });

  test("injects standard comparison banner with shadow root and structured layout", () => {
    const mockResult = {
      co2_kg: 5.2,
      severity: "medium",
      analogy: "Like running a light bulb",
      credit_delta: -15,
      current_pros: ["pro 1"],
      current_cons: ["con 1"],
      alternative_name: "Sustainable Alternative",
      alternative_co2_kg: 1.2,
      alternative_pros: ["alt pro"],
      alternative_cons: ["alt con"],
      saving_kg: 4.0,
      saving_message: "Switching saves 4.0 kg",
      usedFallback: false
    };

    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const html = window.buildCardHTML(mockResult, "Original Product · Store");

    window.EcoScoreUI.showBanner(html, { onAccept, onDismiss });

    const host = document.getElementById("ecoscore-root");
    expect(host).not.toBeNull();
    expect(host.shadowRoot).not.toBeNull();

    // Check accessibility ARIA attributes
    expect(host.getAttribute("role")).toBe("alertdialog");
    expect(host.getAttribute("aria-modal")).toBe("true");

    const shadow = host.shadowRoot;
    const title = shadow.getElementById("card-title");
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Carbon Comparison");

    const analogy = shadow.getElementById("card-analogy");
    expect(analogy).not.toBeNull();
    expect(analogy.textContent).toContain("Like running a light bulb");

    // Check progress bars role
    const progressBars = shadow.querySelectorAll('[role="progressbar"]');
    expect(progressBars.length).toBe(2);
    expect(progressBars[0].getAttribute("aria-valuenow")).toBe("81"); // 5.2 / (5.2 + 1.2) * 100 ~ 81%
  });

  test("triggers onDismiss when close button is clicked", () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const html = window.buildCardHTML({}, "Test Item");

    window.EcoScoreUI.showBanner(html, { onAccept, onDismiss });
    
    const host = document.getElementById("ecoscore-root");
    const closeBtn = host.shadowRoot.getElementById("btn-close");
    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onDismiss).toHaveBeenCalledWith("dismissed");
    expect(document.getElementById("ecoscore-root")).toBeNull(); // Banner should be removed
  });

  test("triggers onAccept when switch button is clicked", () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const html = window.buildCardHTML({}, "Test Item");

    window.EcoScoreUI.showBanner(html, { onAccept, onDismiss });
    
    const host = document.getElementById("ecoscore-root");
    const switchBtn = host.shadowRoot.getElementById("btn-switch");
    expect(switchBtn).not.toBeNull();

    switchBtn.click();

    expect(onAccept).toHaveBeenCalled();
    expect(document.getElementById("ecoscore-root")).toBeNull(); // Banner should be removed
  });

  test("dismisses banner on Escape key down", () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const html = window.buildCardHTML({}, "Test Item");

    window.EcoScoreUI.showBanner(html, { onAccept, onDismiss });

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);

    expect(onDismiss).toHaveBeenCalledWith("keyboard");
    expect(document.getElementById("ecoscore-root")).toBeNull();
  });

  test("injects coming soon banner and dismisses it", () => {
    window.EcoScoreUI.showComingSoonBanner("zomato");

    const host = document.getElementById("ecoscore-root");
    expect(host).not.toBeNull();

    const shadow = host.shadowRoot;
    expect(shadow.getElementById("card-title").textContent).toBe("EcoScore");
    expect(shadow.getElementById("card-desc").textContent).toContain("Zomato");

    const proceedBtn = shadow.getElementById("btn-proceed");
    expect(proceedBtn).not.toBeNull();
    
    proceedBtn.click();
    expect(document.getElementById("ecoscore-root")).toBeNull();
  });
});
