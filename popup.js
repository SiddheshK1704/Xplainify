/**
 * Xplainify — Main Popup Controller
 * Coordinates editorial UI transitions, dynamic model resolution,
 * resilient extraction pipelines, and graceful error recovery.
 */

import { getApiKey, hasApiKey, saveContextMenuCode, getContextMenuCode, clearContextMenuCode } from './js/storage.js';
import { callGemini, normalizeGeminiError } from './js/api.js';
import { buildSummaryPrompt, buildCodeExplanationPrompt } from './js/prompts.js';
import { renderResultSafe, copyToClipboard, formatLanguage } from './js/utils.js';

// State
let currentView = 'main';
let isLoading = false;
let detectedCodeBlocks = [];
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
async function updateApiStatus() {
  const hasKey = await hasApiKey();
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
 * Main Summarize Page flow with complete stage validation.
 */
async function handleSummarize() {
  if (isLoading) return;

  const hasKey = await hasApiKey();
  if (!hasKey) {
    showView('setup');
    return;
  }

  lastAction = 'summarize';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('Unable to identify active browser tab. Please reload the page.');
    }

    if (isRestrictedUrl(tab.url)) {
      throw new Error('Xplainify cannot read internal browser or extension store pages. Navigate to a regular web article or documentation page.');
    }

    // Set loading state
    isLoading = true;
    if (loadingText) loadingText.textContent = 'SUMMARIZING';
    if (loadingSubtext) loadingSubtext.textContent = 'FINDING THE SIGNAL';
    showView('loading');

    // Extract content via robust in-memory script execution
    const executionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runPageExtraction
    });

    if (!executionResults || !executionResults[0] || !executionResults[0].result) {
      throw new Error('Could not extract text from this webpage. The page may still be loading or protected.');
    }

    const extraction = executionResults[0].result;
    if (extraction.error || !extraction.content || extraction.content.length < 30) {
      throw new Error(extraction.error || 'This page does not contain enough readable article text to summarize.');
    }

    const apiKey = await getApiKey();
    const pageContent = `Title: ${extraction.title}\n\n${extraction.content}`;
    const prompt = buildSummaryPrompt(pageContent);

    const summary = await callGemini(apiKey, prompt);

    currentResultText = summary;
    renderResultSafe(resultContent, summary);
    showView('result');

  } catch (err) {
    console.error('Summarize pipeline notice:', err.message || err);
    displayError(err);
  } finally {
    isLoading = false;
  }
}

/**
 * Inline extraction function executed safely in page context.
 */
function runPageExtraction() {
  try {
    const title = document.title ? document.title.trim() : '';
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.theme-doc-markdown',
      '.docs-content',
      '.documentation',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.markdown-body',
      '#content',
      '#main-content',
      '.content'
    ];

    let mainContent = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim().length > 100) {
        mainContent = el;
        break;
      }
    }

    if (!mainContent) mainContent = document.body;
    if (!mainContent) return { title, content: '', error: 'Page has no body content.' };

    const clone = mainContent.cloneNode(true);
    const noise = clone.querySelectorAll(
      'script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, ' +
      '[role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
      '.sidebar, .nav, .navbar, .menu, .footer, .header, .ad, .ads, .advertisement, ' +
      '.social-share, .cookie-banner, .consent-banner, .popup, .modal, .dialog, form, .comment-section, .comments'
    );
    noise.forEach(el => el.remove());

    let text = clone.textContent || '';
    text = text.replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();

    if (!text || text.length < 40) {
      return { title, content: '', error: 'This page contains minimal or no readable article text.' };
    }

    const maxLength = 25000;
    if (text.length > maxLength) {
      let truncateAt = text.lastIndexOf('.', maxLength);
      if (truncateAt === -1 || truncateAt < maxLength - 2000) {
        truncateAt = text.lastIndexOf('\n', maxLength);
      }
      if (truncateAt === -1) truncateAt = maxLength;
      text = text.substring(0, truncateAt) + '\n\n[Content truncated for length]';
    }

    return { title, content: text };
  } catch (e) {
    return { title: document.title || '', content: '', error: e.toString() };
  }
}

/**
 * Handle Code Detection on active tab.
 */
async function handleCodeDetection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: runCodeDetection
    });

    if (results && results[0] && Array.isArray(results[0].result) && results[0].result.length > 0) {
      detectedCodeBlocks = results[0].result;
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
  } catch (err) {
    // Non-fatal, page might not allow script execution
    if (explainCard) explainCard.style.display = 'none';
  }
}

/**
 * Inline code detector executed in page context.
 */
function runCodeDetection() {
  try {
    const selectors = 'pre code, pre.highlight, .highlight pre, .code-block, [class*="language-"]';
    let elements = Array.from(document.querySelectorAll(selectors));
    
    const standalonePres = document.querySelectorAll('pre');
    standalonePres.forEach(pre => {
      if (!pre.querySelector('code') && !elements.includes(pre)) {
        if ((pre.textContent || '').split('\n').length > 1) {
          elements.push(pre);
        }
      }
    });

    const blocks = [];
    const seen = new Set();
    const processedParents = new Set();

    elements.forEach((el, index) => {
      if (el.tagName && el.tagName.toLowerCase() === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
        if (processedParents.has(el.parentElement)) return;
        processedParents.add(el.parentElement);
      }

      const text = (el.textContent || '').trim();
      const lines = text.split(/\r\n|\r|\n/);
      if (lines.length < 3 || text.length < 50) return;

      if (seen.has(text)) return;
      seen.add(text);

      let language = 'unknown';
      const classes = Array.from(el.classList).concat(el.parentElement ? Array.from(el.parentElement.classList) : []);
      for (const cls of classes) {
        if (cls.startsWith('language-') || cls.startsWith('lang-')) {
          language = cls.replace(/^language-|^lang-/, '');
          break;
        }
        const known = ['python', 'javascript', 'typescript', 'js', 'ts', 'html', 'css', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'sql', 'bash', 'shell', 'json', 'yaml', 'ruby', 'swift', 'kotlin'];
        if (known.includes(cls.toLowerCase())) {
          language = cls.toLowerCase();
          break;
        }
      }

      blocks.push({
        code: text.substring(0, 10000),
        language,
        lineCount: lines.length,
        index
      });
    });

    return blocks;
  } catch {
    return [];
  }
}

/**
 * Routes to single code explanation or snippet selection list.
 */
function handleExplainCode() {
  if (detectedCodeBlocks.length === 0) return;

  if (detectedCodeBlocks.length === 1) {
    const block = detectedCodeBlocks[0];
    lastAction = 'explain';
    lastCodeToExplain = { code: block.code, language: block.language };
    explainProvidedCode(block.code, block.language);
  } else {
    // Show selection list
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
  lastAction = 'explain-selected';
  lastCodeToExplain = { code: block.code, language: block.language };
  await explainProvidedCode(block.code, block.language);
}

/**
 * Explains an arbitrary code snippet.
 */
async function explainProvidedCode(codeString, language = '') {
  if (isLoading) return;

  const hasKey = await hasApiKey();
  if (!hasKey) {
    showView('setup');
    return;
  }

  try {
    isLoading = true;
    if (loadingText) loadingText.textContent = 'EXPLAINING CODE';
    if (loadingSubtext) loadingSubtext.textContent = 'TRACING THE LOGIC';
    showView('loading');

    const apiKey = await getApiKey();
    const prompt = buildCodeExplanationPrompt(codeString, language);
    const explanation = await callGemini(apiKey, prompt);

    currentResultText = explanation;
    renderResultSafe(resultContent, explanation);
    showView('result');

  } catch (err) {
    console.error('Explain pipeline notice:', err.message || err);
    displayError(err);
  } finally {
    isLoading = false;
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
 * Initializes the popup.
 */
async function init() {
  await updateApiStatus();

  // Attach event listeners
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

  // Active tab context & code detection
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      updatePageContext(tab);
      if (tab.id && !isRestrictedUrl(tab.url)) {
        await handleCodeDetection(tab.id);
      }
    }
  } catch (err) {
    console.warn('Initial tab query notice:', err);
  }

  // Check if opened via Context Menu (selection)
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
    console.warn('Context menu check notice:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
