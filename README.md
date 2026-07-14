# LeetCode Gemini Auto Solver

A modern, feature-rich Chrome Extension (Manifest V3) that automatically solves LeetCode problems using the Google Gemini API (via Google AI Studio) and directly injects the solution into LeetCode's Monaco Editor. It can also simulate and submit the solution automatically!

## 🚀 Features

- **Gemini API Integration**: Leverages Google Gemini API (AI Studio) to generate highly optimal solutions.
- **Automatic Language & Code Detection**: Detects your selected programming language and extracts starter templates directly from the LeetCode editor.
- **Monaco Editor Injection**: Safely injects the generated solution code into Monaco Editor, preserving the undo/redo history.
- **Auto-Submit**: Optionally simulates natural user timing and submits the solution directly to LeetCode automatically.
- **Comprehensive Language Support**: Supports C++, Python, Java, C, Go, Rust, JavaScript, TypeScript, Swift, Kotlin, SQL (MySQL, PostgreSQL, MS SQL, Oracle), and more.
- **Execution Log Console**: Features a live terminal execution log inside the extension popup showing API responses, extraction updates, and pipeline steps.
- **Modern Status Overlay**: Renders a beautiful status and loading state directly on the LeetCode web page.
- **Keyboard Shortcut**: Press `Ctrl + Shift + S` (or `Cmd + Shift + S` on macOS) to solve the current problem instantly.

---

## 🛠️ File Structure

The extension contains the following source files:

- [`gjj/manifest.json`](file:///c:/Users/gunja/Downloads/gj/gjj/manifest.json): Extension configuration detailing permissions (`storage`, `scripting`, `activeTab`), match rules, background service worker, popup action, and hotkey shortcuts.
- [`gjj/background.js`](file:///c:/Users/gunja/Downloads/gj/gjj/background.js): Orchestrates the entire solving pipeline. Communicates with content scripts, calls the Gemini API, normalizes prompt guidelines, adds necessary language imports (e.g. Python typings, Java utilities), and runs scripts in the main page context to write code to Monaco.
- [`gjj/content.js`](file:///c:/Users/gunja/Downloads/gj/gjj/content.js): Content script running in the LeetCode page context. Handles GraphQL or DOM scraping of problem details, displays a custom toast status overlay, and triggers the submit button click.
- **`gjj/popup/`**: The visual settings card and logs window.
  - [`popup/popup.html`](file:///c:/Users/gunja/Downloads/gj/gjj/popup/popup.html): UI layout, selection options, and terminal container.
  - [`popup/popup.css`](file:///c:/Users/gunja/Downloads/gj/gjj/popup/popup.css): Styling for dark mode, toggles, custom buttons, scrollbars, and fonts.
  - [`popup/popup.js`](file:///c:/Users/gunja/Downloads/gj/gjj/popup/popup.js): Binds event handlers, saves preferences automatically using Chrome Sync storage, retrieves status logs, and triggers executions.

---

## ⚙️ Installation

1. Clone or download this repository.
2. In Google Chrome, navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the **`gjj`** folder from the file dialog.

---

## 📖 How to Use

1. **Get an API Key**: Obtain a free API Key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. **Configure Extension**: Click the **Gemini Solver** extension icon in your Chrome toolbar:
   - Paste your **Gemini API Key**.
   - Choose a preferred **Gemini Model** (e.g. `Gemini 3.5 Flash`, `Gemini 3.5 Pro`).
   - Select a target **Language** (or choose `Auto-Detect` to match your active LeetCode editor language).
   - Toggle **Auto-Submit Solution** if you'd like the extension to click "Submit" automatically after code injection.
3. **Solve Problems**:
   - Navigate to any problem page on [LeetCode](https://leetcode.com/problems/).
   - Click **Solve with Gemini** in the popup, or use the keyboard shortcut `Ctrl + Shift + S` (macOS: `Cmd + Shift + S`).
   - Monitor status updates in the **Execution Log** or in the status overlay on the page.

---

## 🔒 Permissions & Safety

- `storage`: Required to securely store your API Key, preferred model, language, and toggle preferences locally on your Chrome sync profile.
- `scripting` & `activeTab`: Needed to communicate with LeetCode pages, extract problem content, inject code, and click the submit button.
- All Gemini API calls are made directly from your browser to Google Generative Language APIs (`https://generativelanguage.googleapis.com/*`) without any intermediary servers.
