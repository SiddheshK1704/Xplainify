import { getApiKey, hasApiKey, saveContextMenuCode, getContextMenuCode, clearContextMenuCode } from './js/storage.js';
import { callGemini } from './js/api.js';
import { buildSummaryPrompt, buildCodeExplanationPrompt } from './js/prompts.js';
import { renderResultSafe, copyToClipboard, formatLanguage } from './js/utils.js';

// State
let currentView = 'main';
let isLoading = false;
let detectedCodeBlocks = [];
let currentResultText = '';
let selectedCodeIndex = -1;

// Elements
const views = {
  main: document.getElementById('main-view'),
  setup: document.getElementById('setup-view'),
  loading: document.getElementById('loading-view'),
  result: document.getElementById('result-view'),
  'code-select': document.getElementById('code-select-view'),
  error: document.getElementById('error-view')
};

const statusIndicator = document.getElementById('status-indicator');
const summarizeBtn = document.getElementById('summarize-btn');
const explainBtn = document.getElementById('explain-btn');
const settingsBtn = document.getElementById('settings-btn');
const portfolioLink = document.getElementById('portfolio-link');

// Setup View Buttons
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
const loadingText = document.getElementById('loading-text');

/**
 * Switch the current active view.
 * @param {string} viewName 
 */
function showView(viewName) {
  Object.values(views).forEach(el => el.classList.remove('active'));
  if (views[viewName]) {
    views[viewName].classList.add('active');
    currentView = viewName;
  }
}

/**
 * Initialize popup logic.
 */
async function init() {
  await updateApiStatus();
  
  // Set up listeners
  summarizeBtn.addEventListener('click', handleSummarize);
  explainBtn.addEventListener('click', handleExplainCodeView);
  
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  });

  portfolioLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://siddheshk17-portfolio.vercel.app/' });
  });

  getKeyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/api-keys' });
  });

  openSettingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  });

  resultBackBtn.addEventListener('click', () => showView('main'));
  copyBtn.addEventListener('click', handleCopy);

  codeSelectBackBtn.addEventListener('click', () => showView('main'));
  explainSelectedBtn.addEventListener('click', handleExplainSelectedCode);

  retryBtn.addEventListener('click', () => showView('main'));
  errorBackBtn.addEventListener('click', () => showView('main'));

  // Check for active tab to detect code blocks and show page context
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      updatePageContext(tab);
      if (tab.id && !isRestrictedUrl(tab.url)) {
        await handleCodeDetection(tab.id);
      }
    }
  } catch (err) {
    console.warn("Failed to query tab on init", err);
  }

  // Check if opened via Context Menu
  const contextMenuCode = await getContextMenuCode();
  if (contextMenuCode) {
    await clearContextMenuCode();
    chrome.runtime.sendMessage({ type: 'clear-badge' });
    await explainProvidedCode(contextMenuCode);
  }
}

/**
 * Updates the current page context (domain and title preview).
 */
function updatePageContext(tab) {
  const pageContextEl = document.getElementById('page-context');
  const pageDomainEl = document.getElementById('page-domain');
  const pageTitleEl = document.getElementById('page-title-preview');
  
  if (!tab || !tab.url || isRestrictedUrl(tab.url)) {
    if (pageContextEl) pageContextEl.style.display = 'none';
    if (pageTitleEl) pageTitleEl.style.display = 'none';
    return;
  }

  try {
    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    if (pageDomainEl && domain) {
      pageDomainEl.textContent = domain;
      if (pageContextEl) pageContextEl.style.display = 'flex';
    }
    if (pageTitleEl && tab.title) {
      pageTitleEl.textContent = tab.title;
      pageTitleEl.title = tab.title;
      pageTitleEl.style.display = 'block';
    }
  } catch (e) {
    // Ignore URL parse errors
  }
}

/**
 * Check if the URL is restricted and cannot be injected.
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://'];
  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

/**
 * Updates the API status indicator based on key presence.
 */
async function updateApiStatus() {
  const hasKey = await hasApiKey();
  if (hasKey) {
    statusIndicator.textContent = 'Ready';
    statusIndicator.className = 'status-value configured';
  } else {
    statusIndicator.textContent = 'Not configured';
    statusIndicator.className = 'status-value not-configured';
  }
  return hasKey;
}

/**
 * Handle Summarize Page action.
 */
async function handleSummarize() {
  if (isLoading) return;
  const hasKey = await hasApiKey();
  if (!hasKey) {
    showView('setup');
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("Could not find active tab.");
    
    if (isRestrictedUrl(tab.url)) {
      throw new Error("Cannot summarize restricted browser pages.");
    }

    isLoading = true;
    loadingText.textContent = 'Summarizing';
    const subtextEl = document.getElementById('loading-subtext');
    if (subtextEl) subtextEl.textContent = 'Finding the signal';
    showView('loading');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Inline content extraction function
        try {
          const title = document.title || "";
          let mainNode = document.querySelector('article') || 
                         document.querySelector('[role="main"]') || 
                         document.querySelector('main') || 
                         document.querySelector('.post-content') || 
                         document.querySelector('.article-content') || 
                         document.querySelector('.markdown-body') || 
                         document.body;
                         
          if (!mainNode) return { title, content: "" };

          const clone = mainNode.cloneNode(true);
          const noiseSelectors = [
            'script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header', 
            'aside', '.sidebar', '.ad', '.ads', '.cookie-banner', '[role="navigation"]'
          ];
          
          noiseSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
          });

          let textContent = clone.textContent || "";
          textContent = textContent.replace(/\s+/g, ' ').trim();
          
          // Truncate to avoid massive payloads
          if (textContent.length > 25000) {
            textContent = textContent.substring(0, 25000) + '...';
          }
          
          return { title, content: textContent };
        } catch (e) {
          return { title: document.title, content: "", error: e.toString() };
        }
      }
    });

    if (result.error || !result.content) {
      throw new Error(result.error || "Could not extract content from the page.");
    }

    loadingText.textContent = 'Summarizing';
    if (subtextEl) subtextEl.textContent = 'Finding the signal';
    
    const apiKey = await getApiKey();
    const pageContent = `Page Title: ${result.title}\n\n${result.content}`;
    const prompt = buildSummaryPrompt(pageContent);
    const summary = await callGemini(apiKey, prompt);
    
    currentResultText = summary;
    renderResultSafe(resultContent, summary);
    showView('result');

  } catch (err) {
    console.error("Summarize error:", err);
    errorMessage.textContent = err.message || "An unexpected error occurred.";
    showView('error');
  } finally {
    isLoading = false;
  }
}

/**
 * Handle Explain Code view transition.
 */
function handleExplainCodeView() {
  if (detectedCodeBlocks.length === 0) return;
  
  codeList.replaceChildren();
  selectedCodeIndex = -1;
  explainSelectedBtn.disabled = true;

  detectedCodeBlocks.forEach((block, index) => {
    const card = document.createElement('div');
    card.className = 'code-card';
    card.dataset.index = index;
    
    const header = document.createElement('div');
    header.className = 'code-card-header';
    
    const langSpan = document.createElement('span');
    langSpan.className = 'code-card-lang';
    langSpan.textContent = formatLanguage ? formatLanguage(block.language) : block.language || 'Code';
    
    const linesSpan = document.createElement('span');
    linesSpan.className = 'code-card-lines';
    linesSpan.textContent = `${block.lineCount} lines`;
    
    header.appendChild(langSpan);
    header.appendChild(linesSpan);
    
    const preview = document.createElement('div');
    preview.className = 'code-card-preview';
    preview.textContent = block.code;
    
    card.appendChild(header);
    card.appendChild(preview);
    
    card.addEventListener('click', () => {
      document.querySelectorAll('.code-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCodeIndex = index;
      explainSelectedBtn.disabled = false;
    });

    codeList.appendChild(card);
  });

  showView('code-select');
}

/**
 * Explains the selected code block.
 */
async function handleExplainSelectedCode() {
  if (selectedCodeIndex === -1 || selectedCodeIndex >= detectedCodeBlocks.length) return;
  
  const block = detectedCodeBlocks[selectedCodeIndex];
  await explainProvidedCode(block.code, block.language);
}

/**
 * Explains arbitrary provided code string (from selection or context menu).
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
    loadingText.textContent = 'Explaining Code';
    const subtextEl = document.getElementById('loading-subtext');
    if (subtextEl) subtextEl.textContent = 'Tracing the logic';
    showView('loading');

    const apiKey = await getApiKey();
    const prompt = buildCodeExplanationPrompt(codeString, language);
    const explanation = await callGemini(apiKey, prompt);
    
    currentResultText = explanation;
    renderResultSafe(resultContent, explanation);
    showView('result');
  } catch (err) {
    console.error("Explain error:", err);
    errorMessage.textContent = err.message || "An unexpected error occurred.";
    showView('error');
  } finally {
    isLoading = false;
  }
}

/**
 * Handle Code Detection on active tab.
 */
async function handleCodeDetection(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Inline code detection function
        try {
          const codeElements = document.querySelectorAll('pre code, pre.highlight, .highlight pre, [class*="language-"]');
          let blocks = [];
          const seen = new Set();
          
          const nodes = Array.from(codeElements).concat(Array.from(document.querySelectorAll('pre')));
          
          nodes.forEach((node, index) => {
            const text = node.textContent.trim();
            if (!text || text.length < 50) return;
            
            const lines = text.split('\n');
            if (lines.length < 3) return;

            // Simple dedup
            if (seen.has(text)) return;
            seen.add(text);

            // Attempt to get language from classes
            let language = 'text';
            const classes = Array.from(node.classList).concat(node.parentElement ? Array.from(node.parentElement.classList) : []);
            const langClass = classes.find(c => c.startsWith('language-') || c.startsWith('lang-'));
            if (langClass) {
              language = langClass.replace('language-', '').replace('lang-', '');
            }

            blocks.push({
              code: text.substring(0, 10000), // prevent huge blocks
              language,
              lineCount: lines.length,
              index
            });
          });

          return blocks;
        } catch (e) {
          return [];
        }
      }
    });

    if (result && result.length > 0) {
      detectedCodeBlocks = result;
      // Show the explain card
      const explainCard = document.getElementById('explain-card');
      if (explainCard) explainCard.style.display = 'block';
      explainBtn.style.display = 'flex';
      // Populate code metadata
      const codeMeta = document.getElementById('code-meta');
      if (codeMeta && result.length > 0) {
        const first = result[0];
        const lang = formatLanguage ? formatLanguage(first.language) : first.language || 'Code';
        const totalBlocks = result.length;
        codeMeta.textContent = totalBlocks === 1 
          ? `${lang} · ${first.lineCount} lines`
          : `${totalBlocks} blocks found · ${lang} + more`;
      }
    }
  } catch (err) {
    console.warn("Could not detect code blocks:", err);
  }
}

/**
 * Copies the current result to clipboard.
 */
async function handleCopy() {
  if (!currentResultText) return;
  
  try {
    const success = copyToClipboard 
      ? await copyToClipboard(currentResultText)
      : await navigator.clipboard.writeText(currentResultText).then(() => true).catch(() => false);
    
    if (!success) return;

    const labelEl = copyBtn.querySelector('.copy-btn-label');
    const targetEl = labelEl || copyBtn;
    const originalText = targetEl.textContent;

    targetEl.textContent = '✓ Copied';
    copyBtn.classList.add('success');
    
    setTimeout(() => {
      targetEl.textContent = originalText;
      copyBtn.classList.remove('success');
    }, 1800);
  } catch (err) {
    console.error("Copy failed:", err);
  }
}

document.addEventListener('DOMContentLoaded', init);
