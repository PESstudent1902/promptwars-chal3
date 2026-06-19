# EcoScore — Privacy Policy

Last updated: June 19, 2026

EcoScore ("we", "our", or "the Extension") is committed to protecting your privacy. This Privacy Policy details what information is collected, stored, and transmitted during your use of the extension.

## 1. Core Philosophy
* **Carbon Awareness, Not Carbon Tracking**: We believe you shouldn't have to sacrifice your personal privacy to understand your environmental footprint.
* **No Server Backend**: EcoScore runs entirely within your browser. There is no central database or analytics server tracking your actions.

## 2. What Information is Stored Locally
All data is stored directly on your computer using Google Chrome's secure storage APIs:
* **API Key (`chrome.storage.local`)**: Your Google Gemini API key is stored locally on your device. It is never shared with us or any third party.
* **Eco Credits & History (`chrome.storage.sync` & `chrome.storage.local`)**: Your streak, current score level, and a history of the last 50 eco-actions are saved to allow the extension to calculate summaries. 
  * `chrome.storage.sync` is utilized for score statistics so they sync across your personal logged-in Chrome instances.
  * Action history details are saved in `chrome.storage.local` and never sync outside the active device.

## 3. What Information is Transmitted
When you browse a supported e-commerce, ride-hailing, food delivery, or travel portal, EcoScore analyzes the active product:
* **Item Names & Categories**: To obtain the carbon footprint estimate, the product name (e.g. "Polyester T-Shirt") and its category (e.g. "clothing") are sanitized to remove HTML tags/special characters and then sent directly to the Google Gemini API.
* **No PII Transmission**: No Personal Identifiable Information (PII), user identity, login credentials, payment details, full addresses, or browsing history are ever sent with these requests.
* **Direct Communication**: Network calls to Google Gemini (`https://generativelanguage.googleapis.com`) go directly from your browser to Google. No middleware or proxy servers are used.

## 4. What is NOT Collected or Processed
* We **do not** collect, store, or sell your browsing history.
* We **do not** track your orders or purchase amounts.
* We **do not** collect any location tracking data (only voluntary city location settings you explicitly select are stored locally to customize carbon estimates).

## 5. Security Measures
* **Origin Allowlist**: EcoScore background workers enforce strict origin checking on any page HTML fetching requests (restricting requests to allowed e-commerce domains like Amazon, Flipkart, and Myntra) to prevent Server-Side Request Forgery (SSRF).
* **DOM Sanitization**: All content script outputs use safe text projection methods to avoid Cross-Site Scripting (XSS) risks.
* **CSP Policy**: The extension enforces a tight Content Security Policy (CSP) blocking external scripts from executing inside extension contexts.

## 6. Access and Deletion
You have complete control over your data. At any time, you can:
* Remove your Gemini API Key in the **Settings** tab.
* Clear all history, streak, and score records by clicking the **Reset All Data** button inside the Settings page.
* Uninstall the extension, which automatically deletes all locally stored storage variables.

## 7. Contact
For any questions regarding this Privacy Policy, you can inspect the open-source codebase of this extension.
