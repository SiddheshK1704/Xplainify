/**
 * Xplainify — Content Script
 * Executes canonical extraction and code detection when messages are received.
 */

function extractPageContent() {
  try {
    const title = document.title ? document.title.trim() : '';

    const prioritySelectors = [
      'article',
      'main',
      '[role="main"]',
      '#mw-content-text',
      '.theme-doc-markdown',
      '.docs-content',
      '.documentation',
      '.markdown-body',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
      '#main-content',
      '.story-body',
      '.article-body',
      '#root main',
      '#__next main'
    ];

    let contentRoot = null;
    for (const selector of prioritySelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim().length > 100) {
        contentRoot = el;
        break;
      }
    }

    if (!contentRoot) contentRoot = document.body;
    if (!contentRoot) {
      return {
        title,
        content: '',
        error: "Xplainify couldn't find enough readable content on this page."
      };
    }

    const clone = contentRoot.cloneNode(true);
    const noiseSelectors = [
      'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio',
      'nav', 'footer', 'header', 'aside',
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
      '.sidebar', '.nav', '.navbar', '.menu', '.footer', '.header',
      '.ad', '.ads', '.advertisement', '.social-share', '.share-buttons',
      '.cookie-banner', '.consent-banner', '.gdpr-banner',
      '.popup', '.modal', '.dialog', 'form', 'button', 'input', 'select', 'textarea',
      '.comments', '#comments', '.comment-section'
    ].join(', ');

    clone.querySelectorAll(noiseSelectors).forEach(el => el.remove());

    const signalNodes = clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre');
    let extractedSegments = [];
    const targetLength = 15000;
    const hardLimit = 18000;
    let totalChars = 0;

    if (signalNodes.length > 0) {
      for (const node of signalNodes) {
        if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) {
          continue;
        }

        const tag = node.tagName.toLowerCase();
        let segmentText = '';

        if (tag === 'ul' || tag === 'ol') {
          const listItems = Array.from(node.querySelectorAll('li'))
            .map(li => `- ${li.textContent.trim()}`)
            .filter(t => t.length > 3);
          if (listItems.length > 0) {
            segmentText = listItems.join('\n');
          }
        } else if (tag.startsWith('h')) {
          const hText = node.textContent.trim();
          if (hText.length > 0) {
            segmentText = `\n### ${hText}\n`;
          }
        } else {
          segmentText = node.textContent.trim();
        }

        if (!segmentText || segmentText.length < 5) continue;

        if (totalChars + segmentText.length > targetLength) {
          if (totalChars > 10000) {
            extractedSegments.push('\n\n[Content truncated for length]');
            totalChars += 32;
            break;
          }
          if (totalChars + segmentText.length > hardLimit) {
            const allowed = hardLimit - totalChars;
            let cutIdx = segmentText.lastIndexOf('.', allowed);
            if (cutIdx === -1 || cutIdx < allowed - 200) {
              cutIdx = segmentText.lastIndexOf(' ', allowed);
            }
            if (cutIdx === -1) cutIdx = allowed;
            extractedSegments.push(segmentText.substring(0, cutIdx) + '\n\n[Content truncated for length]');
            break;
          }
        }

        extractedSegments.push(segmentText);
        totalChars += segmentText.length;
      }
    }

    let finalContent = extractedSegments.join('\n\n').trim();

    if (!finalContent || finalContent.length < 50) {
      let rawText = (clone.textContent || '').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
      if (rawText.length > hardLimit) {
        let cutIdx = rawText.lastIndexOf('.', hardLimit);
        if (cutIdx === -1 || cutIdx < hardLimit - 500) {
          cutIdx = hardLimit;
        }
        rawText = rawText.substring(0, cutIdx) + '\n\n[Content truncated for length]';
      }
      finalContent = rawText;
    }

    finalContent = finalContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (!finalContent || finalContent.length < 50) {
      return {
        title,
        content: '',
        error: "Xplainify couldn't find enough readable content on this page."
      };
    }

    return {
      title,
      content: finalContent
    };
  } catch (err) {
    return {
      title: document.title || '',
      content: '',
      error: "Xplainify couldn't find enough readable content on this page."
    };
  }
}

function detectCodeBlocks() {
  try {
    const results = [];
    const selectors = 'pre code, pre.highlight, .highlight pre, .code-block, [class*="language-"]';
    let codeElements = Array.from(document.querySelectorAll(selectors));

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
      if (el.tagName && el.tagName.toLowerCase() === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
        if (processedParents.has(el.parentElement)) return;
        processedParents.add(el.parentElement);
      }

      const text = (el.textContent || '').trim();
      const lines = text.split(/\r\n|\r|\n/);
      const lineCount = lines.length;

      if (lineCount < 3 || text.length < 50) return;
      if (seenTexts.has(text)) return;
      seenTexts.add(text);

      let detectedLang = 'unknown';
      const classes = Array.from(el.classList).concat(el.parentElement ? Array.from(el.parentElement.classList) : []);

      for (const cls of classes) {
        if (cls.startsWith('language-') || cls.startsWith('lang-')) {
          detectedLang = cls.replace(/^language-|^lang-/, '');
          break;
        }
        const known = [
          'python', 'javascript', 'typescript', 'js', 'ts', 'html', 'css',
          'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'sql', 'bash',
          'shell', 'json', 'yaml', 'ruby', 'swift', 'kotlin'
        ];
        if (known.includes(cls.toLowerCase())) {
          detectedLang = cls.toLowerCase();
          break;
        }
      }

      results.push({
        code: text.substring(0, 10000),
        language: detectedLang,
        lineCount,
        index
      });
    });

    return results;
  } catch {
    return [];
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extract-content') {
    const result = extractPageContent();
    sendResponse(result);
  } else if (request.type === 'detect-code') {
    const result = detectCodeBlocks();
    sendResponse(result);
  }
  return true;
});
