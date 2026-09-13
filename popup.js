/**
 * Xplainify — Main Popup Controller
 * Coordinates editorial UI transitions, canonical extraction pipelines,
 * deferred non-blocking code detection, request state locking, and graceful recovery.
 */

import { getApiKey, hasApiKey, saveContextMenuCode, getContextMenuCode, clearContextMenuCode } from './js/storage.js';
import { callGemini, normalizeGeminiError } from './js/api.js';
import { extractPageContent, detectCodeBlocks } from './js/extractor.js';
import { buildSummaryPrompt, buildCodeExplanationPrompt } from './js/prompts.js';
import { renderResultSafe, copyToClipboard, formatLanguage } from './js/utils.js';

const popupStartTime = performance.now();

// State Management
let currentView = 'main';
let requestState = 'IDLE'; // 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'
let detectedCodeBlocks = [];
let cachedTabId = null;
let cachedCodeBlocks = null;
let currentResultText = '';
let selectedCodeIndex = -1;
let lastAction = null; // 'summarize' | 'explain' | 'explain-selected'
let lastCodeToExplain = null;

// DOM View Registry
const views = {
  main: document.getElementById('main-view'),
  setup: document.getElementById('setup-view'),
  loading: document.getElementById('loading-view'),
  result: document.getElementById('result-view'),
  'code-select': document.getElementById('code-select-view'),
  error: document.getElementById('error-view')
};

// UI Elements
const statusIndicator = document.getElementById('status-indicator');
const summarizeBtn = document.getElementById('summarize-btn');
const explainBtn = document.getElementById('explain-btn');
const explainCard = document.getElementById('explain-card');
const codeMeta = document.getElementById('code-meta');
const pageTitlePreview = document.getElementById('page-title-preview');
const pageDomain = document.getElementById('page-domain');
const settingsBtn = document.getElementById('settings-btn');
const portfolioLink = document.getElementById('portfolio-link');

// Setup View Elements
const getKeyBtn = document.getElementById('get-key-btn');
const openSettingsBtn = document.getElementById('open-settings-btn');

// Result View Elements
const resultBackBtn = document.getElementById('result-back-btn');
const copyBtn = document.getElementById('copy-btn');
const resultContent = document.getElementById('result-content');

// Code Select Elements
const codeSelectBackBtn = document.getElementById('code-select-back-btn');
const codeList = document.getElementById('code-list');
const explainSelectedBtn = document.getElementById('explain-selected-btn');

// Error Elements
const retryBtn = document.getElementById('retry-btn');
const errorBackBtn = document.getElementById('error-back-btn');
const errorMessage = document.getElementById('error-message');

// Loading Elements
const loadingText = document.getElementById('loading-text');
const loadingSubtext = document.getElementById('loading-subtext');

/**
 * Transitions to a named view.
 * @param {string} viewName 
 */
function showView(viewName) {
  Object.values(views).forEach(el => {
    if (el) el.classList.remove('active');
  });
  if (views[viewName]) {
    views[viewName].classList.add('active');
    currentView = viewName;
  }
}

/**
 * Updates request state and locks/unlocks buttons to prevent double actions.
 * @param {'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'} state 
 */
function setRequestState(state) {
  requestState = state;
  const isBusy = state === 'LOADING';
  if (summarizeBtn) summarizeBtn.disabled = isBusy;
  if (explainBtn) explainBtn.disabled = isBusy;
  if (explainSelectedBtn) explainSelectedBtn.disabled = isBusy || selectedCodeIndex < 0;
}

/**
 * Checks if a URL cannot be injected or read due to Chrome security policies.
 * @param {string} url 
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'about:',
    'edge://',
    'brave://',
    'devtools://',
    'view-source:'
  ];
  if (restrictedPrefixes.some(prefix => url.startsWith(prefix))) {
    return true;
  }
  if (url.includes('chromewebstore.google.com') || url.includes('chrome.google.com/webstore')) {
    return true;
  }
  return false;
}

/**
 * Updates the current page context header (domain and page title).
 * @param {chrome.tabs.Tab} tab 
 */
function updatePageContext(tab) {
  if (!tab || !tab.url || isRestrictedUrl(tab.url)) {
    if (pageTitlePreview) pageTitlePreview.textContent = 'Browser System Page';
    if (pageDomain) pageDomain.textContent = 'Restricted';
    if (summarizeBtn) summarizeBtn.disabled = true;
    return;
  }

  try {
    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    if (pageDomain) pageDomain.textContent = domain;
    if (pageTitlePreview) {
      pageTitlePreview.textContent = tab.title || domain;
      pageTitlePreview.title = tab.title || '';
    }
    if (summarizeBtn) summarizeBtn.disabled = false;
  } catch {
    if (pageTitlePreview) pageTitlePreview.textContent = tab.title || 'Current Webpage';
  }
}

/**
 * Updates AI status indicator in bottom bar without exposing model strings.
 */
function updateApiStatusIndicator(hasKey) {
  const labelEl = statusIndicator ? statusIndicator.querySelector('.status-label') : null;

  if (hasKey) {
    if (statusIndicator) statusIndicator.className = 'ai-status configured';
    if (labelEl) labelEl.textContent = 'AI READY';
  } else {
    if (statusIndicator) statusIndicator.className = 'ai-status not-configured';
    if (labelEl) labelEl.textContent = 'KEY REQUIRED';
  }
  return hasKey;
}

/**
 * Main Summarize Page flow using canonical extraction engine.
 */
async function handleSummarize() {
  if (requestState === 'LOADING') return;

  const hasKey = await hasApiKey();
  if (!hasKey) {
    showView('setup');
    return;
  }

  const t0 = performance.now();
  lastAction = 'summarize';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('Unable to identify active browser tab. Please reload the page.');
    }

    if (isRestrictedUrl(tab.url)) {
      throw new Error('Xplainify cannot read internal browser or extension store pages. Navigate to a regular web article or documentation page.');
    }

    // Set loading state & lock controls
    setRequestState('LOADING');
    if (loadingText) loadingText.textContent = 'SUMMARIZING';
    if (loadingSubtext) loadingSubtext.textContent = 'EXTRACTING KEY TAKEAWAYS';
    const inlineSkeleton = document.getElementById('inline-skeleton');
    if (inlineSkeleton) inlineSkeleton.style.display = 'flex';
    showView('loading');

    // Extract content using the canonical extractor from js/extractor.js
    const tExtractStart = performance.now();
    const executionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    if (!executionResults || !executionResults[0] || !executionResults[0].result) {
      throw new Error("Xplainify couldn't find enough readable content on this page.");
    }

    const extraction = executionResults[0].result;
    if (extraction.error || !extraction.content || extraction.content.length < 50) {
      throw new Error(extraction.error || "Xplainify couldn't find enough readable content on this page.");
    }
    const tExtractEnd = performance.now();

    const apiKey = await getApiKey();
    const pageContent = `Title: ${extraction.title}\n\n${extraction.content}`;
    const prompt = buildSummaryPrompt(pageContent);

    const tApiStart = performance.now();
    const summary = await callGemini(apiKey, prompt, 'summary');
    const tApiEnd = performance.now();

    currentResultText = summary;
    const tRenderStart = performance.now();
    renderResultSafe(resultContent, summary);
    const tRenderEnd = performance.now();

    setRequestState('SUCCESS');
    showView('result');

    console.info(`[Xplainify][Perf] Summarize pipeline: extraction=${(tExtractEnd - tExtractStart).toFixed(1)}ms, api=${(tApiEnd - tApiStart).toFixed(1)}ms, render=${(tRenderEnd - tRenderStart).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`);

  } catch (err) {
    console.warn('[Xplainify][Popup] Summarize notice:', err.message || err);
    setRequestState('ERROR');
    displayError(err);
  } finally {
    if (requestState === 'LOADING') setRequestState('IDLE');
    const inlineSkeleton = document.getElementById('inline-skeleton');
    if (inlineSkeleton) inlineSkeleton.style.display = 'none';
  }
}

/**
 * Handles Code Detection on active tab with caching to avoid duplicate DOM scans.
 * @param {number} tabId 
 */
async function handleCodeDetection(tabId) {
  // Check tab code detection cache
  if (cachedTabId === tabId && cachedCodeBlocks !== null) {
    applyDetectedCodeBlocks(cachedCodeBlocks);
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectCodeBlocks
    });

    if (results && results[0] && Array.isArray(results[0].result)) {
      cachedTabId = tabId;
      cachedCodeBlocks = results[0].result;
      applyDetectedCodeBlocks(cachedCodeBlocks);
    } else {
      if (explainCard) explainCard.style.display = 'none';
    }
  } catch {
    // Non-fatal: page might restrict script injection
    if (explainCard) explainCard.style.display = 'none';
  }
}

/**
 * Applies detected code blocks to UI metadata.
 * @param {Array<Object>} blocks 
 */
function applyDetectedCodeBlocks(blocks) {
  detectedCodeBlocks = blocks;
  if (detectedCodeBlocks.length > 0) {
    if (explainCard) explainCard.style.display = 'block';

    if (codeMeta) {
      const first = detectedCodeBlocks[0];
      const lang = formatLanguage ? formatLanguage(first.language) : (first.language || 'Code');
      const count = detectedCodeBlocks.length;
      codeMeta.textContent = count === 1 
        ? `${lang} · ${first.lineCount} lines`
        : `${lang} · ${first.lineCount} lines (${count} snippets detected)`;
    }
  } else {
    if (explainCard) explainCard.style.display = 'none';
  }
}

/**
 * Routes to single code explanation or snippet selection list.
 * Re-scans the page for fresh detection to handle SPA/late-rendered code.
 */
async function handleExplainCode() {
  // Re-scan fresh to catch late-rendered code (SPAs, dynamic file views)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && !isRestrictedUrl(tab.url)) {
      cachedTabId = null;
      cachedCodeBlocks = null;
      await handleCodeDetection(tab.id);
    }
  } catch {
    // Non-fatal: proceed with existing detection
  }

  if (!detectedCodeBlocks || detectedCodeBlocks.length === 0) return;

  if (detectedCodeBlocks.length === 1) {
    const block = detectedCodeBlocks[0];
    if (!block || !block.code) return;
    lastAction = 'explain';
    lastCodeToExplain = { code: block.code, language: block.language || '' };
    explainProvidedCode(block.code, block.language);
  } else {
    renderCodeSelectionList();
    showView('code-select');
  }
}

/**
 * Renders multiple detected code snippets for user selection.
 */
function renderCodeSelectionList() {
  if (!codeList) return;
  codeList.replaceChildren();
  selectedCodeIndex = -1;
  if (explainSelectedBtn) explainSelectedBtn.disabled = true;

  detectedCodeBlocks.forEach((block, index) => {
    const item = document.createElement('div');
    item.className = 'code-card';
    item.dataset.index = index;

    const header = document.createElement('div');
    header.className = 'code-card-header';

    const langSpan = document.createElement('span');
    langSpan.className = 'code-card-lang';
    langSpan.textContent = formatLanguage ? formatLanguage(block.language) : (block.language || 'Code');

    const linesSpan = document.createElement('span');
    linesSpan.className = 'code-card-lines';
    linesSpan.textContent = `${block.lineCount} lines`;

    header.appendChild(langSpan);
    header.appendChild(linesSpan);

    const preview = document.createElement('div');
    preview.className = 'code-card-preview';
    preview.textContent = block.code;

    item.appendChild(header);
    item.appendChild(preview);

    item.addEventListener('click', () => {
      document.querySelectorAll('.code-card').forEach(c => c.classList.remove('selected'));
      item.classList.add('selected');
      selectedCodeIndex = index;
      if (explainSelectedBtn) explainSelectedBtn.disabled = false;
    });

    codeList.appendChild(item);
  });
}

/**
 * Explains snippet selected from the list.
 */
async function handleExplainSelectedCode() {
  if (selectedCodeIndex < 0 || selectedCodeIndex >= detectedCodeBlocks.length) return;
  const block = detectedCodeBlocks[selectedCodeIndex];
  if (!block || !block.code) return;
  lastAction = 'explain-selected';
  lastCodeToExplain = { code: block.code, language: block.language || '' };
  await explainProvidedCode(block.code, block.language);
}

/**
 * Explains an arbitrary code snippet.
 */
async function explainProvidedCode(codeString, language = '') {
  if (requestState === 'LOADING') return;

  const hasKey = await hasApiKey();
  if (!hasKey) {
    showView('setup');
    return;
  }

  if (!codeString || typeof codeString !== 'string' || codeString.trim().length === 0) {
    displayError(new Error('No code snippet was detected or selected to explain.'));
    return;
  }

  const t0 = performance.now();
  try {
    setRequestState('LOADING');
    if (loadingText) loadingText.textContent = 'EXPLAINING CODE';
    if (loadingSubtext) loadingSubtext.textContent = 'TRACING THE LOGIC';
    showView('loading');

    const apiKey = await getApiKey();
    if (!apiKey) {
      showView('setup');
      return;
    }

    const prompt = buildCodeExplanationPrompt(codeString, language);
    const tApiStart = performance.now();
    const explanation = await callGemini(apiKey, prompt, 'code');
    const tApiEnd = performance.now();

    currentResultText = explanation;
    const tRenderStart = performance.now();
    renderResultSafe(resultContent, explanation);
    const tRenderEnd = performance.now();

    setRequestState('SUCCESS');
    showView('result');

    console.info(`[Xplainify][Perf] Explain code pipeline: api=${(tApiEnd - tApiStart).toFixed(1)}ms, render=${(tRenderEnd - tRenderStart).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`);

  } catch (err) {
    console.warn('[Xplainify][Popup] Explain notice:', err.message || err);
    setRequestState('ERROR');
    displayError(err);
  } finally {
    if (requestState === 'LOADING') setRequestState('IDLE');
  }
}

/**
 * Handles errors gracefully, surfacing clear copy and direct settings access for auth failures.
 */
function displayError(err) {
  const isAuth = err.isAuth || (err.message && (
    err.message.includes('API key') || 
    err.message.includes('Settings') || 
    err.message.includes('unauthorized') || 
    err.message.includes('invalid') ||
    err.message.includes('401') ||
    err.message.includes('403')
  ));

  if (errorMessage) {
    errorMessage.textContent = err.message || 'We were unable to complete that request. Please try again.';
  }

  const errorSettingsBtn = document.getElementById('error-settings-btn');
  if (errorSettingsBtn && retryBtn) {
    if (isAuth) {
      errorSettingsBtn.style.display = 'inline-flex';
      retryBtn.style.display = 'none';
    } else {
      errorSettingsBtn.style.display = 'none';
      retryBtn.style.display = 'inline-flex';
    }
  }

  showView('error');
}

/**
 * Handles copy-to-clipboard in Result view.
 */
async function handleCopy() {
  if (!currentResultText) return;
  try {
    const success = copyToClipboard 
      ? await copyToClipboard(currentResultText)
      : await navigator.clipboard.writeText(currentResultText).then(() => true).catch(() => false);

    if (!success) return;

    const label = copyBtn.querySelector('.copy-btn-label') || copyBtn;
    const original = label.textContent;
    label.textContent = '✓ COPIED';
    copyBtn.classList.add('success');

    setTimeout(() => {
      label.textContent = original;
      copyBtn.classList.remove('success');
    }, 1800);
  } catch {
    // Ignore clipboard error
  }
}

/**
 * Handles retry button click from error view.
 */
function handleRetry() {
  if (lastAction === 'summarize') {
    handleSummarize();
  } else if ((lastAction === 'explain' || lastAction === 'explain-selected') && lastCodeToExplain) {
    explainProvidedCode(lastCodeToExplain.code, lastCodeToExplain.language);
  } else {
    showView('main');
  }
}

/**
 * Attaches all static DOM event listeners.
 */
function attachEventListeners() {
  if (summarizeBtn) summarizeBtn.addEventListener('click', handleSummarize);
  if (explainBtn) explainBtn.addEventListener('click', handleExplainCode);

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    });
  }

  if (portfolioLink) {
    portfolioLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://siddheshk17-portfolio.vercel.app/' });
    });
  }

  if (getKeyBtn) {
    getKeyBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://aistudio.google.com/app/api-keys' });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    });
  }

  if (resultBackBtn) resultBackBtn.addEventListener('click', () => showView('main'));
  if (copyBtn) copyBtn.addEventListener('click', handleCopy);

  if (codeSelectBackBtn) codeSelectBackBtn.addEventListener('click', () => showView('main'));
  if (explainSelectedBtn) explainSelectedBtn.addEventListener('click', handleExplainSelectedCode);

  if (retryBtn) retryBtn.addEventListener('click', handleRetry);
  if (errorBackBtn) errorBackBtn.addEventListener('click', () => showView('main'));

  const errorSettingsBtn = document.getElementById('error-settings-btn');
  if (errorSettingsBtn) {
    errorSettingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    });
  }

  // Delegated click handler for source citations [§N] in result view
  if (resultContent) {
    resultContent.addEventListener('click', handleCitationClick);
    resultContent.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleCitationClick(e);
      }
    });
  }

  // Real-time listener for dynamic code blocks detected by page MutationObserver
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'xplainify-code-updated' && Array.isArray(message.blocks)) {
      applyDetectedCodeBlocks(message.blocks);
    }
  });
}

/**
 * Handles click on a source citation ([§N] or [L1]) in the result view.
 * Injects a scroll+highlight function into the active tab or highlights local code snippet.
 * @param {Event} e
 */
async function handleCitationClick(e) {
  const ref = e.target.closest('.source-ref');
  if (!ref) return;

  const srcIndex = ref.dataset.src;
  const lineIndex = ref.dataset.line;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || isRestrictedUrl(tab.url)) return;

    if (srcIndex) {
      // Inject highlight CSS once per tab
      await injectHighlightCSS(tab.id);

      // Inject scroll-to-highlight function on page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (index) => {
          const el = document.querySelector(`[data-xplainify-src="${index}"]`);
          if (!el) return;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('xplainify-highlight');
          // Force reflow for re-animation
          void el.offsetWidth;
          el.classList.add('xplainify-highlight');
          setTimeout(() => {
            el.classList.remove('xplainify-highlight');
          }, 2500);
        },
        args: [srcIndex]
      });
    } else if (lineIndex) {
      // Line citation in code explanation: scroll to code on page if available
      await injectHighlightCSS(tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const codeEl = document.querySelector('[data-xplainify-src^="code-"], pre code, pre');
          if (!codeEl) return;
          codeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          codeEl.classList.remove('xplainify-highlight');
          void codeEl.offsetWidth;
          codeEl.classList.add('xplainify-highlight');
          setTimeout(() => {
            codeEl.classList.remove('xplainify-highlight');
          }, 2500);
        }
      });
    }
  } catch (err) {
    console.warn('[Xplainify][Popup] Citation scroll notice:', err.message || err);
  }
}

/** Tracks which tabs have already received highlight CSS injection. */
const highlightInjectedTabs = new Set();

/**
 * Injects highlight CSS into the active tab once.
 * Uses a flat background tint + left border consistent with sharp geometry (no blur/glow).
 * @param {number} tabId
 */
async function injectHighlightCSS(tabId) {
  if (highlightInjectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: `
        @keyframes xplainify-source-fade {
          0% {
            background-color: rgba(66, 116, 217, 0.16);
            border-left-color: #4274D9;
          }
          70% {
            background-color: rgba(66, 116, 217, 0.12);
            border-left-color: #4274D9;
          }
          100% {
            background-color: transparent;
            border-left-color: transparent;
          }
        }
        .xplainify-highlight {
          animation: xplainify-source-fade 2.5s ease-out forwards !important;
          border-left: 3px solid #4274D9 !important;
          border-radius: 0px !important;
          padding-left: 8px !important;
          box-shadow: none !important;
          outline: none !important;
        }
      `
    });
    highlightInjectedTabs.add(tabId);
  } catch {
    // Non-fatal: page might restrict CSS injection
  }
}

/**
 * Initializes the popup with fast parallel queries and deferred code detection.
 */
async function init() {
  // 1. Parallelize independent queries for near-instant popup load
  let tab = null;
  let hasKey = false;
  try {
    const [tabResults, keyStatus] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      hasApiKey()
    ]);
    if (tabResults && tabResults.length > 0) {
      tab = tabResults[0];
    }
    hasKey = keyStatus;
  } catch (err) {
    console.warn('[Xplainify][Popup] Parallel init notice:', err);
  }

  // 2. Immediately render context and AI readiness
  updateApiStatusIndicator(hasKey);
  if (tab) {
    updatePageContext(tab);
  }

  // 3. Attach event listeners
  attachEventListeners();
  console.info(`[Xplainify][Perf] Popup ready in ${(performance.now() - popupStartTime).toFixed(1)}ms`);

  // 4. Deferred non-blocking code detection via requestIdleCallback
  if (tab && tab.id && !isRestrictedUrl(tab.url)) {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
    schedule(() => {
      handleCodeDetection(tab.id);
    });
  }

  // 5. Check if opened via Context Menu (selection)
  try {
    const contextMenuCode = await getContextMenuCode();
    if (contextMenuCode) {
      await clearContextMenuCode();
      chrome.runtime.sendMessage({ type: 'clear-badge' });
      lastAction = 'explain';
      lastCodeToExplain = { code: contextMenuCode, language: '' };
      await explainProvidedCode(contextMenuCode);
    }
  } catch (err) {
    console.warn('[Xplainify][Popup] Context menu check notice:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
