function extractPageContent() {
  const title = document.title;
  let mainElement = 
    document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.querySelector('.post-content, .article-content, .entry-content, .content, .markdown-body') ||
    document.body;

  const clone = mainElement.cloneNode(true);

  const noiseSelectors = [
    'script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript', 'svg',
    '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
    '.sidebar', '.nav', '.menu', '.footer', '.header', '.ad', '.advertisement', 
    '.social-share', '.cookie-banner', '.popup', '.modal'
  ];

  noiseSelectors.forEach(selector => {
    const elements = clone.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });

  let textContent = clone.textContent || '';
  
  // Collapse multiple whitespace/newlines into single newlines
  textContent = textContent.replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();

  // Smart truncation
  const maxLength = 25000;
  if (textContent.length > maxLength) {
    let truncateAt = textContent.lastIndexOf('.', maxLength);
    if (truncateAt === -1 || truncateAt < maxLength - 1000) {
      truncateAt = textContent.lastIndexOf('\n', maxLength);
    }
    if (truncateAt === -1) {
      truncateAt = maxLength;
    }
    textContent = textContent.substring(0, truncateAt) + '\n\n[Content truncated for length]';
  }

  return { title, content: textContent };
}

function detectCodeBlocks() {
  const codeSelectors = 'pre code, pre.highlight, .highlight pre, .code-block, [class*="language-"]';
  let elements = Array.from(document.querySelectorAll(codeSelectors));
  
  const standalonePres = document.querySelectorAll('pre');
  standalonePres.forEach(pre => {
    if (!pre.querySelector('code') && !elements.includes(pre)) {
      if (pre.textContent.split('\n').length > 1) {
        elements.push(pre);
      }
    }
  });

  const results = [];
  const processedElements = new Set();

  elements.forEach((el, index) => {
    // Deduplicate logic
    if (processedElements.has(el)) return;
    if (el.tagName.toLowerCase() === 'code' && el.parentElement.tagName.toLowerCase() === 'pre') {
      processedElements.add(el.parentElement);
    }
    
    const textContent = el.textContent || '';
    const trimmed = textContent.trim();
    const lines = trimmed.split('\n');
    
    if (lines.length < 3 || trimmed.length < 50) return;

    let language = 'unknown';
    const classes = Array.from(el.classList).concat(el.parentElement ? Array.from(el.parentElement.classList) : []);
    
    const langClass = classes.find(c => c.startsWith('language-') || c.startsWith('lang-'));
    if (langClass) {
      language = langClass.replace('language-', '').replace('lang-', '');
    }

    results.push({
      code: trimmed,
      language,
      lineCount: lines.length,
      index
    });
  });

  return results;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extract-content') {
    const result = extractPageContent();
    sendResponse(result);
  } else if (request.type === 'detect-code') {
    const result = detectCodeBlocks();
    sendResponse(result);
  }
  return true; // async response
});
