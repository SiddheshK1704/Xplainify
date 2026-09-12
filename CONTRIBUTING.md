# Contributing to Xplainify

Thank you for your interest in contributing to **Xplainify**! We welcome contributions from developers of all skill levels. Whether you are fixing a bug, refining prompt engineering, improving extraction heuristics, or polishing documentation, your help makes Xplainify better for everyone.

Please take a moment to review this document before submitting issues or pull requests.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment. All contributors and participants are expected to:
- Be respectful and constructive in discussions and code reviews.
- Focus on what is best for the community and the project.
- Gracefully accept constructive criticism.
- Report any unacceptable behavior to the project maintainer.

---

## Philosophy & Core Principles

Before writing code for Xplainify, understand our fundamental architectural principles:

1. **Zero Frameworks & Zero Bundlers**: Xplainify is built strictly with vanilla JavaScript (ES modules), HTML5, and modern CSS. There is no React, Vue, Svelte, Webpack, Vite, or Babel. Avoid adding `node_modules` or npm dependencies to the runtime.
2. **Zero Backend Intermediaries**: Xplainify is a direct client-to-API extension. We will never add an intermediary server or telemetry proxy that intercepts user traffic.
3. **Sharp 0px Editorial Geometry**: The user interface follows a strict editorial aesthetic. All borders have `border-radius: 0px`. Do not introduce rounded cards, pill buttons, or heavy shadows.
4. **Safe DOM Rendering**: `innerHTML` is strictly forbidden for user or AI content. All dynamic content must be created using safe DOM APIs (`document.createElement`, `textContent`) or passed through `renderResultSafe()`.
5. **Strict Security Fencing**: All webpage content and code snippets are treated as **untrusted data**. Prompts must maintain security fences to defend against prompt injection.

---

## Development Setup

Because Xplainify has no build step, getting started takes less than two minutes.

### Prerequisites
- [Google Chrome](https://www.google.com/chrome/) (or any Chromium-based browser such as Brave, Edge, or Arc).
- [Node.js](https://nodejs.org/) (optional, only used to run quick syntax validation via `node --check`).
- A free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/api-keys).

### Local Setup

1. **Fork and Clone the Repository**:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Xplainify.git
   cd Xplainify
   ```

2. **Load the Unpacked Extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`.
   - Toggle **Developer mode** in the top-right corner.
   - Click **Load unpacked** in the top-left corner.
   - Select the root `Xplainify/` directory containing `manifest.json`.

3. **Configure Your API Key**:
   - Click the Xplainify icon in the Chrome toolbar.
   - Click the **Gear (⚙️)** icon in the header to open Settings.
   - Paste your Gemini API key and click **Save Settings**.

---

## Coding Standards & Guidelines

### 1. Vanilla JavaScript (ES Modules)
- Use standard modern ECMAScript (ES2022+).
- Use ES module syntax (`import` / `export`). Note: Chrome extension service workers support ES modules via `"type": "module"` in `manifest.json`.
- Keep functions modular and self-contained. Functions injected via `chrome.scripting.executeScript` (such as those in `js/extractor.js`) must be self-contained and not rely on external closure scope.

### 2. Styling & CSS Rules
- Maintain the strict editorial design system:
  - **Border Radius**: Always `0px`. Never use `border-radius: 4px`, `8px`, or `9999px`.
  - **Colors**: Use CSS custom variables defined in `popup.css` and `settings.css` (`var(--bg)`, `var(--text)`, `var(--border)`, `var(--accent)`, etc.).
  - **Typography Hierarchy**:
    - Display / Brand titles: `Geist Sans`, system fallbacks
    - UI, controls, and body text: `Plus Jakarta Sans`, system fallbacks
    - Code blocks, line numbers, and citations: `JetBrains Mono`, monospace
  - **Structure**: Use subtle `1px solid var(--border)` dividers and purposeful whitespace instead of heavy shadows or card borders.

### 3. Security & DOM Safety
- **No `innerHTML`**: Never write `element.innerHTML = aiResponse`. Always use `document.createElement`, `element.textContent`, or the centralized renderer `renderResultSafe()` in [js/utils.js](file:///c:/Users/siddh/Desktop/Projects/Xplainify/js/utils.js).
- **Prompt Injection Defenses**: Any newly added prompts in [js/prompts.js](file:///c:/Users/siddh/Desktop/Projects/Xplainify/js/prompts.js) must:
  - Enclose untrusted user/webpage input in explicit boundary markers (e.g. `--- BEGIN WEBPAGE CONTENT ---`).
  - Include explicit instructions commanding the model not to execute or follow embedded instructions.
- **Header-Based Transport**: Always pass API keys via the `x-goog-api-key` HTTP header. Never append the API key to URL query parameters or log it in `console.error`.

### 4. Error Handling
- Use the custom `GeminiApiError` class in [js/api.js](file:///c:/Users/siddh/Desktop/Projects/Xplainify/js/api.js) to classify API failures (authentication, rate limits, timeouts, model 404s).
- Provide user-friendly, actionable error messages in the popup UI rather than raw HTTP status dumps.

---

## How to Test Changes Locally

Before opening a pull request, thoroughly test your changes across multiple environments and edge cases.

### 1. Syntax Validation
Run Node's built-in syntax checker across all JavaScript files:
```bash
node --check background.js popup.js settings.js js/*.js
```
All commands should exit cleanly with no syntax errors.

### 2. Extension Reloading
- If you edited `popup.html`, `popup.css`, or `popup.js`: Simply close and reopen the extension popup to see changes.
- If you edited `background.js` or `manifest.json`: Go to `chrome://extensions/` and click the **Reload** (circular arrow) icon on the Xplainify card.

### 3. Inspecting Logs
- **Popup UI Logs**: Right-click the extension popup and choose **Inspect** to open Chrome DevTools for the popup.
- **Service Worker Logs**: In `chrome://extensions/`, click **service worker** under Xplainify to open DevTools for `background.js`.
- **Injected Script Logs**: Inspect the active webpage's normal DevTools console to see logs from `extractor.js`.

### 4. Manual Test Scenarios
Ensure your changes do not cause regressions in these scenarios:
1. **Wikipedia Articles**: Test that math formulas, IPA pronunciations, and reference lists are correctly excluded by the weighted code detection model.
2. **Technical Documentation**: Test on MDN, GitHub READMEs, and Docusaurus sites to ensure headings, lists, and code blocks are preserved.
3. **Interactive Citations**: Verify that clicking `[§N]` badges in the summary smoothly scrolls the parent tab to the referenced paragraph and activates the 2.5s highlight animation.
4. **Code Explanation**: Select a code block on a page, explain it, and check that line references (`[L1]`, `[L2]`) match the snippet.
5. **Context Menu**: Select code, right-click, click "Xplainify: Explain Selected Code", and ensure the popup opens with the explanation loaded.
6. **Edge Pages**: Test on restricted pages (`chrome://extensions/`, blank tabs) to verify graceful error notices.

---

## Pull Request Process

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Commit Your Changes**:
   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add export summary to markdown button`
   - `fix: prevent code block index out of bounds on empty pages`
   - `docs: update installation instructions in README`
   - `style: enforce 0px border-radius on citation badges`
   - `refactor: optimize candidate selector tree in extractor.js`

3. **Push to Your Fork**:
   ```bash
   git push origin feat/your-feature-name
   ```

4. **Submit a Pull Request**:
   - Open a PR against the `main` branch of `SiddheshK1704/Xplainify`.
   - Provide a clear summary of what changed and why.
   - Reference any relevant issues (e.g., `Fixes #12`).
   - Include screenshots or GIFs for any UI modifications.

---

## Questions or Need Help?

Feel free to open an issue or reach out via [Siddhesh Khankhoje's Portfolio](https://siddheshk17-portfolio.vercel.app/). Thank you for helping make Xplainify clearer, faster, and more reliable!
