/**
 * Xplainify — Content & Code Extraction Engine
 * Resilient DOM traversal, intelligent container selection, aggressive noise stripping,
 * and code block detection.
 */

export function extractPageContent() {
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

  if (!mainContent) {
    mainContent = document.body;
  }

  if (!mainContent) {
    return { title, content: '', error: 'Unable to locate readable content on this page.' };
  }

  const clone = mainContent.cloneNode(true);

  // Aggressive noise stripping
  const elementsToRemove = clone.querySelectorAll(
    'script, style, noscript, iframe, svg, canvas, ' +
    'nav, footer, header, aside, ' +
    '[role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
    '.sidebar, .nav, .navbar, .menu, .footer, .header, ' +
    '.ad, .ads, .advertisement, .social-share, .cookie-banner, .consent-banner, ' +
    '.popup, .modal, .dialog, form, .comment-section, .comments'
  );

  elementsToRemove.forEach(el => el.remove());

  let text = clone.textContent || '';
  
  // Collapse whitespace and trim
  text = text.replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();

  // Validate meaningful content
  if (!text || text.length < 40) {
    return { title, content: '', error: 'This page does not contain enough readable article text.' };
  }

  // Smart truncation at 25,000 characters
  const maxLength = 25000;
  if (text.length > maxLength) {
    let truncateIndex = text.lastIndexOf('.', maxLength);
    if (truncateIndex === -1 || truncateIndex < maxLength - 2000) {
      truncateIndex = text.lastIndexOf('\n', maxLength);
    }
    if (truncateIndex === -1) {
      truncateIndex = maxLength;
    }
    text = text.substring(0, truncateIndex) + '\n\n[Content truncated for length]';
  }

  return { title, content: text };
}

export function detectCodeBlocks() {
  const results = [];
  const codeElements = Array.from(document.querySelectorAll('pre code, pre.highlight, .highlight pre, .code-block, [class*="language-"]'));
  
  // Also include standalone <pre> without nested <code>
  const standalonePres = document.querySelectorAll('pre');
  standalonePres.forEach(pre => {
    if (!pre.querySelector('code') && !codeElements.includes(pre)) {
      if ((pre.textContent || '').split('\n').length > 1) {
        codeElements.push(pre);
      }
    }
  });

  const seenTexts = new Set();
  const processedParents = new Set();

  codeElements.forEach((el, index) => {
    // Prevent nested duplication
    if (el.tagName && el.tagName.toLowerCase() === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
      if (processedParents.has(el.parentElement)) return;
      processedParents.add(el.parentElement);
    }

    const text = (el.textContent || '').trim();
    const lines = text.split(/\r\n|\r|\n/);
    const lineCount = lines.length;

    // Minimum meaningful code criteria: at least 3 lines and 50 characters
    if (lineCount < 3 || text.length < 50) return;

    // Deduplicate identical code snippets
    if (seenTexts.has(text)) return;
    seenTexts.add(text);

    // Detect language from class names
    let detectedLang = 'unknown';
    const classes = Array.from(el.classList).concat(el.parentElement ? Array.from(el.parentElement.classList) : []);
    
    for (const cls of classes) {
      if (cls.startsWith('language-') || cls.startsWith('lang-')) {
        detectedLang = cls.replace(/^language-|^lang-/, '');
        break;
      }
      const known = ['python', 'javascript', 'typescript', 'js', 'ts', 'html', 'css', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'sql', 'bash', 'shell', 'json', 'yaml', 'ruby', 'swift', 'kotlin'];
      if (known.includes(cls.toLowerCase())) {
        detectedLang = cls.toLowerCase();
        break;
      }
    }

    results.push({
      code: text.substring(0, 10000), // Protect against memory bloat
      language: detectedLang,
      lineCount,
      index
    });
  });

  return results;
}
