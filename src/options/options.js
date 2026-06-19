/**
 * options.js — Settings page
 * Handles API key save/test/clear and data reset.
 */

const apiKeyInput   = document.getElementById("api-key-input");
const toggleVisBtn  = document.getElementById("toggle-visibility");
const eyeIcon       = document.getElementById("eye-icon");
const saveKeyBtn    = document.getElementById("save-key-btn");
const testKeyBtn    = document.getElementById("test-key-btn");
const clearKeyBtn   = document.getElementById("clear-key-btn");
const apiKeyStatus  = document.getElementById("api-key-status");
const resetDataBtn  = document.getElementById("reset-data-btn");
const toast         = document.getElementById("toast");
const confirmDialog = document.getElementById("confirm-dialog");
const dialogMsg     = document.getElementById("dialog-msg");
const dialogConfirm = document.getElementById("dialog-confirm");
const dialogCancel  = document.getElementById("dialog-cancel");

// ─── Load existing key on open ────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const { gemini_api_key } = await chrome.storage.local.get(["gemini_api_key"]);
  if (gemini_api_key) {
    apiKeyInput.value = gemini_api_key;
    setStatus("Key saved and ready. ✓", "success");
  }
});

// ─── Toggle visibility ────────────────────────────────────────────────────────

toggleVisBtn.addEventListener("click", () => {
  const show = apiKeyInput.type === "password";
  apiKeyInput.type = show ? "text" : "password";
  eyeIcon.textContent = show ? "🙈" : "👁";
  toggleVisBtn.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
});

// ─── Save ─────────────────────────────────────────────────────────────────────

function isValidApiKeyFormat(key) {
  // Accept any non-empty string — let the Gemini API itself reject invalid keys
  return !!(key && typeof key === "string" && key.trim().length > 0);
}

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus("Please enter your API key.", "error"); apiKeyInput.focus(); return; }
  await chrome.storage.local.set({ gemini_api_key: key });
  setStatus("Key saved successfully. ✓", "success");
  showToast("API key saved!");
});

// ─── Test connection ──────────────────────────────────────────────────────────

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

testKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus("Enter your API key first.", "error"); return; }

  testKeyBtn.textContent = "Testing…";
  testKeyBtn.disabled = true;
  setStatus("", "");

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Reply with the single word: OK" }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0 },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      setStatus(`Connected! Gemini responded: "${reply}" ✓`, "success");
      showToast("Gemini is working ✓");
    } else if (res.status === 429) {
      // 429 = key valid, just rate-limited (15 req/min on free tier)
      setStatus("Key is valid ✓  —  Hit the free tier rate limit (15 req/min). Wait 60s, it resets automatically. EcoScore handles this with auto-retry.", "success");
      showToast("Key valid ✓ — rate limit clears in ~60s");
    } else if (res.status === 400) {
      let body = ""; try { body = await res.text(); } catch {}
      if (body.includes("API_KEY_INVALID") || body.includes("invalid")) {
        setStatus("Invalid API key. Double-check and try again.", "error");
      } else {
        setStatus("Key accepted ✓ (request error, not key error)", "success");
      }
    } else if (res.status === 403) {
      setStatus("Key doesn't have Gemini access. Enable the 'Generative Language API' in Google Cloud Console.", "error");
    } else {
      setStatus(`Connection issue (HTTP ${res.status}). Check your internet and try again.`, "error");
    }
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
  } finally {
    testKeyBtn.textContent = "Test connection";
    testKeyBtn.disabled = false;
  }
});

// ─── Clear key ────────────────────────────────────────────────────────────────

clearKeyBtn.addEventListener("click", () => {
  showConfirm("Remove your Gemini API key? EcoScore will use offline estimates until you add a new one.", async () => {
    await chrome.storage.local.remove(["gemini_api_key"]);
    apiKeyInput.value = "";
    setStatus("API key removed.", "");
    showToast("Key removed.");
  });
});

// ─── Reset all data ───────────────────────────────────────────────────────────

resetDataBtn.addEventListener("click", () => {
  showConfirm("Reset ALL EcoScore data? This clears your score, history, streak, and API key. Cannot be undone.", async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    apiKeyInput.value = "";
    setStatus("", "");
    showToast("All data reset. Fresh start!");
  });
});

// ─── Confirm dialog ───────────────────────────────────────────────────────────

let confirmCb = null;

function showConfirm(message, onConfirm) {
  dialogMsg.textContent = message;
  confirmCb = onConfirm;
  confirmDialog.classList.add("visible");
  dialogConfirm.focus();
}

dialogConfirm.addEventListener("click", async () => {
  confirmDialog.classList.remove("visible");
  if (confirmCb) await confirmCb();
  confirmCb = null;
});

dialogCancel.addEventListener("click", () => {
  confirmDialog.classList.remove("visible");
  confirmCb = null;
});

confirmDialog.addEventListener("click", (e) => {
  if (e.target === confirmDialog) { confirmDialog.classList.remove("visible"); confirmCb = null; }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && confirmDialog.classList.contains("visible")) {
    confirmDialog.classList.remove("visible"); confirmCb = null;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  apiKeyStatus.textContent = msg;
  apiKeyStatus.className = `form-status ${type}`;
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.removeAttribute("hidden");
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.setAttribute("hidden", ""), 250);
  }, 3000);
}
