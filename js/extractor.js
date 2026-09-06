export function extractPageContent() {
  const title = document.title;
  let mainContent = null;
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content, .article-content, .entry-content, .content, .markdown-body'
  ];

  for (const selector of selectors) {
    mainContent = document.querySelector(selector);
    if (mainContent) break;
  }

  if (!mainContent) {
    mainContent = document.body;
  }

  if (!mainContent) {
    return { title, content: '' };
  }

  const clone = mainContent.cloneNode(true);

  const elementsToRemove = clone.querySelectorAll(
    'script, style, nav, footer, header, aside, iframe, noscript, svg, ' +
    '[role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
    '.sidebar, .nav, .menu, .footer, .header, .ad, .advertisement, .social-share, .cookie-banner, .popup, .modal'
  );

  elementsToRemove.forEach(el => el.remove());

  let text = clone.textContent || '';
  
  // Collapse whitespace and trim
  text = text.replace(/\s+/g, ' ').trim();

  // Smart truncation at 25000 characters
  if (text.length > 25000) {
    let truncateIndex = 25000;
    
    // Find the last period before 25000
    const lastPeriod = text.lastIndexOf('.', 25000);
    const lastNewline = text.lastIndexOf('\n', 25000);
    
    if (lastPeriod > -1 && lastPeriod > 10000) {
      truncateIndex = lastPeriod + 1;
    } else if (lastNewline > -1 && lastNewline > 10000) {
      truncateIndex = lastNewline;
    }
    
    text = text.substring(0, truncateIndex) + '\n[Content truncated for length]';
  }

  return { title, content: text };
}

export function detectCodeBlocks() {
  const results = [];
  const codeElements = document.querySelectorAll('pre code, pre.highlight, .highlight pre, .code-block, [class*="language-"]');
  const seenElements = new Set();

  codeElements.forEach((el, i) => {
    let current = el;
    let skip = false;
    while (current && current !== document.body) {
      if (seenElements.has(current)) {
        skip = true;
        break;
      }
      current = current.parentElement;
    }
    
    if (skip) return;

    const text = el.textContent.trim();
    const lines = text.split(/\r\n|\r|\n/);
    const lineCount = lines.length;

    if (lineCount < 3 || text.length < 50) return;

    let detectedLang = '';
    const classNames = (el.className + ' ' + (el.parentElement ? el.parentElement.className : '')).split(/\s+/);
    
    for (const cls of classNames) {
      if (cls.startsWith('language-') || cls.startsWith('lang-') || 
          ['python', 'javascript', 'js', 'html', 'css', 'java', 'cpp', 'hljs', 'bash'].includes(cls)) {
        detectedLang = cls;
        break;
      }
    }

    seenElements.add(el);

    results.push({
      code: text,
      language: detectedLang,
      lineCount: lineCount,
      index: i
    });
  });

  return results;
}
