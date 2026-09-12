/**
 * Xplainify — Content & Code Extraction Engine
 * Single source of truth for webpage text extraction and code detection.
 * Prioritizes high-signal containers, strips noisy page chrome, intelligently limits
 * input length (12k–18k chars), and detects code snippets with weighted scoring.
 * 
 * Note: Functions are self-contained for safe serial execution in tab contexts.
 */

/**
 * Extracts clean, high-signal readable text from the active webpage.
 * Tags each source paragraph with [§N] markers and data-xplainify-src attributes
 * for grounded click-to-source summary citations.
 * Designed for universal compatibility across blogs, documentation, news,
 * wikis, and SPAs.
 * @returns {{ title: string, content: string, sourceCount: number, error?: string }}
 */
export function extractPageContent() {
  try {
    const title = document.title ? document.title.trim() : '';

    // 1. Target high-signal content containers
    const prioritySelectors = [
      'article',
      'main',
      '[role="main"]',
      '#mw-content-text',      // Wikipedia
      '.theme-doc-markdown',   // Docusaurus
      '.docs-content',         // Generic documentation
      '.documentation',
      '.markdown-body',        // GitHub / Markdown
      '.post-content',         // Blogs / WordPress
      '.article-content',
      '.entry-content',
      '#content',
      '#main-content',
      '.story-body',           // News
      '.article-body',
      '#root main',            // SPAs
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

    // Fallback to body if no semantic container found
    if (!contentRoot) {
      contentRoot = document.body;
    }

    if (!contentRoot) {
      return {
        title,
        content: '',
        sourceCount: 0,
        error: "Xplainify couldn't find enough readable content on this page."
      };
    }

    // 2. Clone to avoid mutating the live DOM during noise removal
    const clone = contentRoot.cloneNode(true);

    // 3. Strip obvious page chrome, interactive elements, and noise
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

    // 3. Clear any existing xplainify source markers to avoid stale attributes
    try {
      contentRoot.querySelectorAll('[data-xplainify-src]').forEach(el => el.removeAttribute('data-xplainify-src'));
    } catch (_) {}

    // 4. Intelligent signal extraction with source paragraph tagging:
    // Gather headings, paragraphs, lists, and code blocks directly
    const candidateNodes = contentRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre');
    let extractedSegments = [];
    const targetLength = 12000;
    const hardLimit = 16000;
    let totalChars = 0;
    let sourceIndex = 0;

    if (candidateNodes.length > 0) {
      for (const node of candidateNodes) {
        // Skip nodes inside noise containers in the live DOM
        if (node.closest && node.closest(noiseSelectors)) {
          continue;
        }

        // Skip hidden nodes if inline style hides them
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

        // Assign source index and tag the live DOM element directly
        sourceIndex++;
        try {
          node.setAttribute('data-xplainify-src', String(sourceIndex));
        } catch (_) {}

        // Prefix segment with source marker (except headings — tag the content following them)
        const markedSegment = tag.startsWith('h')
          ? segmentText
          : `[§${sourceIndex}] ${segmentText}`;

        // Check if adding this segment approaches the budget
        if (totalChars + markedSegment.length > targetLength) {
          // If we have at least 10,000 characters, truncate cleanly
          if (totalChars > 10000) {
            extractedSegments.push('\n\n[Content truncated for length]');
            totalChars += 32;
            break;
          }
          // Otherwise cap strictly at hardLimit
          if (totalChars + markedSegment.length > hardLimit) {
            const allowed = hardLimit - totalChars;
            let cutIdx = markedSegment.lastIndexOf('.', allowed);
            if (cutIdx === -1 || cutIdx < allowed - 200) {
              cutIdx = markedSegment.lastIndexOf(' ', allowed);
            }
            if (cutIdx === -1) cutIdx = allowed;
            extractedSegments.push(markedSegment.substring(0, cutIdx) + '\n\n[Content truncated for length]');
            break;
          }
        }

        extractedSegments.push(markedSegment);
        totalChars += markedSegment.length;
      }
    }

    let finalContent = extractedSegments.join('\n\n').trim();

    // 5. Universal Fallback: If querySelectorAll found nothing structured, extract cleaned textContent
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

    // 6. Final Clean: Normalize whitespace and redundant blank lines
    finalContent = finalContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    // 7. Minimum threshold verification: Reject meaningless / empty content
    if (!finalContent || finalContent.length < 50) {
      return {
        title,
        content: '',
        sourceCount: 0,
        error: "Xplainify couldn't find enough readable content on this page."
      };
    }

    return {
      title,
      content: finalContent,
      sourceCount: sourceIndex
    };
  } catch (err) {
    return {
      title: document.title || '',
      content: '',
      sourceCount: 0,
      error: "Xplainify couldn't find enough readable content on this page."
    };
  }
}

/**
 * Detects code snippets in the page using a weighted scoring model.
 * 
 * Scoring approach:
 * - Structural signals (high confidence, can trigger alone): tag combinations,
 *   highlighter classes, editor widgets, platform-specific selectors
 * - Content signals (supporting only): indentation, keyword density, bracket density
 * - Blocklist signals (negative): citations, IPA, math, infoboxes, wikitables
 * - Threshold: element must score ≥ 20 to be classified as code
 * 
 * Self-contained for safe serial execution in tab contexts.
 * @returns {Array<{ code: string, language: string, lineCount: number, index: number }>}
 */
export function detectCodeBlocks() {
  try {
    const results = [];

    // ── Broad candidate gathering ─────────────────────────────────
    const selectors = [
      'pre code',
      'pre.highlight',
      '.highlight pre',
      '.code-block',
      '[class*="language-"]',
      '[class*="hljs"]',
      '[class*="shiki"]',
      '.CodeMirror',
      '.cm-editor',
      '.monaco-editor',
      '.ace_editor',
      '.ace-editor',
      '.gatsby-highlight code',
      '.s-code-block',
      '[data-lang]',
      '[data-language]'
    ].join(', ');

    let codeElements = Array.from(document.querySelectorAll(selectors));

    // Include standalone <pre> without nested <code>
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

    // ── Blocklist class patterns ──────────────────────────────────
    const blocklistClasses = [
      'citation', 'reference', 'reflist', 'mw-references-wrap', 'mw-cite-backlink',
      'IPA', 'unicode',
      'katex', 'MathJax', 'math', 'mwe-math-element',
      'infobox', 'navbox', 'sidebar', 'toc', 'refbegin',
      'wikitable'
    ];

    // ── Programming keywords for content scoring ──────────────────
    const codeKeywords = [
      'function', 'const', 'let', 'var', 'import', 'export', 'class',
      'def', 'return', 'if', 'else', 'for', 'while', 'try', 'catch',
      'async', 'await', 'new', 'this', 'self', 'null', 'undefined',
      'true', 'false', 'void', 'throw', 'switch', 'case', 'break',
      'continue', 'yield', 'from', 'print', 'public', 'private',
      'static', 'extends', 'implements', 'interface', 'enum', 'struct',
      'fn', 'pub', 'mod', 'use', 'crate', 'impl', 'trait',
      'package', 'func', 'fmt', 'defer', 'go', 'chan',
      '#include', '#define', 'typedef', 'sizeof', 'malloc',
      'require', 'module', 'exports', 'console', 'document', 'window'
    ];

    /**
     * Scores a candidate code element using weighted signals.
     * @param {Element} el
     * @param {string} text
     * @param {string[]} lines
     * @returns {number}
     */
    function scoreElement(el, text, lines) {
      let score = 0;
      const tag = (el.tagName || '').toLowerCase();
      const parentTag = el.parentElement ? (el.parentElement.tagName || '').toLowerCase() : '';
      const classes = Array.from(el.classList || []);
      const parentClasses = el.parentElement ? Array.from(el.parentElement.classList || []) : [];
      const allClasses = classes.concat(parentClasses);
      const allClassStr = allClasses.join(' ').toLowerCase();

      // ── Structural signals (high confidence) ────────────────────
      // <pre><code> combination
      if (tag === 'code' && parentTag === 'pre') score += 30;
      else if (tag === 'pre' && el.querySelector('code')) score += 30;

      // language-* / lang-* class
      if (allClasses.some(c => c.startsWith('language-') || c.startsWith('lang-'))) score += 25;

      // Highlighter classes
      if (allClassStr.match(/\bhljs\b|\bhighlight\b|\bshiki\b/)) score += 25;

      // Editor widgets
      if (allClassStr.match(/\bcodemirror\b|\bcm-editor\b|\bmonaco-editor\b|\bace.editor\b|\bace-editor\b/)) score += 30;

      // Platform-specific selectors
      if (allClassStr.match(/\bblob-code-content\b|\bblob-code\b|\bs-code-block\b|\bgatsby-highlight\b|\bdocusaurus-highlight/)) score += 25;

      // data-lang / data-language attribute
      if (el.getAttribute('data-lang') || el.getAttribute('data-language')) score += 20;

      // Standalone <pre> (no <code> child, lower confidence)
      if (tag === 'pre' && !el.querySelector('code') && score === 0) score += 10;

      // ── Content signals (supporting only) ────────────────────────
      // Consistent indentation (≥3 lines with leading whitespace)
      const indentedLines = lines.filter(l => l.match(/^[ \t]{2,}/));
      if (indentedLines.length >= 3) score += 8;

      // Programming keyword density
      const textLower = text.toLowerCase();
      const textLen = Math.max(text.length, 1);
      let kwCount = 0;
      for (const kw of codeKeywords) {
        // Word boundary match using simple indexOf + boundary check
        let idx = 0;
        while ((idx = textLower.indexOf(kw, idx)) !== -1) {
          const before = idx === 0 || /[^a-zA-Z0-9_]/.test(textLower[idx - 1]);
          const after = idx + kw.length >= textLower.length || /[^a-zA-Z0-9_]/.test(textLower[idx + kw.length]);
          if (before && after) kwCount++;
          idx += kw.length;
        }
      }
      const kwDensity = (kwCount / textLen) * 100;
      if (kwDensity >= 3) score += 5;
      else if (kwDensity >= 1.5) score += 3;

      // Bracket/operator density
      const bracketChars = text.replace(/[^{}[\]()=>===;]/g, '');
      const bracketDensity = (bracketChars.length / textLen) * 100;
      if (bracketDensity >= 3) score += 5;
      else if (bracketDensity >= 1.5) score += 3;

      // ── Blocklist / negative signals ─────────────────────────────
      // Check element and ancestors for blocklist classes
      let ancestor = el;
      let ancestorDepth = 0;
      while (ancestor && ancestorDepth < 5) {
        const ancestorClasses = Array.from(ancestor.classList || []);
        for (const cls of ancestorClasses) {
          const clsLower = cls.toLowerCase();
          for (const blocked of blocklistClasses) {
            if (clsLower.includes(blocked.toLowerCase())) {
              score -= 30;
            }
          }
        }
        // Check role="math"
        if (ancestor.getAttribute && ancestor.getAttribute('role') === 'math') {
          score -= 30;
        }
        ancestor = ancestor.parentElement;
        ancestorDepth++;
      }

      // Ancestor is a <table> or wikitable (common false positive container)
      let tableAncestor = el.closest('table');
      if (tableAncestor) {
        const tableClasses = (tableAncestor.className || '').toLowerCase();
        if (tableClasses.includes('wikitable') || tableClasses.includes('infobox')) {
          score -= 15;
        }
      }

      return score;
    }

    // ── Evaluate candidates ───────────────────────────────────────
    codeElements.forEach((el, index) => {
      // Prevent nested duplication (<pre><code>...</code></pre>)
      if (el.tagName && el.tagName.toLowerCase() === 'code' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
        if (processedParents.has(el.parentElement)) return;
        processedParents.add(el.parentElement);
      }

      const text = (el.textContent || '').trim();
      const lines = text.split(/\r\n|\r|\n/);
      const lineCount = lines.length;

      // Minimum meaningful code criteria: at least 3 lines and 50 characters
      if (lineCount < 3 || text.length < 50) return;

      // Deduplicate identical snippets
      if (seenTexts.has(text)) return;
      seenTexts.add(text);

      // Apply weighted scoring
      const score = scoreElement(el, text, lines);
      if (score < 20) return; // Below threshold — not code

      // Detect language from class names, data attributes, and patterns
      let detectedLang = 'unknown';
      const classes = Array.from(el.classList).concat(el.parentElement ? Array.from(el.parentElement.classList) : []);

      // Check data-lang / data-language attributes first
      const dataLang = el.getAttribute('data-lang') || el.getAttribute('data-language')
        || (el.parentElement && (el.parentElement.getAttribute('data-lang') || el.parentElement.getAttribute('data-language')));
      if (dataLang) {
        detectedLang = dataLang.toLowerCase().trim();
      } else {
        for (const cls of classes) {
          if (cls.startsWith('language-') || cls.startsWith('lang-')) {
            detectedLang = cls.replace(/^language-|^lang-/, '');
            break;
          }
          // brush: pattern (older highlighters)
          if (cls.startsWith('brush:')) {
            detectedLang = cls.replace(/^brush:\s*/, '').replace(/;.*$/, '').trim();
            break;
          }
          const known = [
            'python', 'javascript', 'typescript', 'js', 'ts', 'html', 'css',
            'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'sql', 'bash',
            'shell', 'json', 'yaml', 'ruby', 'swift', 'kotlin', 'scala',
            'perl', 'lua', 'r', 'dart', 'elixir', 'haskell', 'clojure',
            'jsx', 'tsx', 'vue', 'svelte', 'markdown', 'toml', 'ini', 'xml',
            'graphql', 'dockerfile', 'makefile', 'cmake', 'zig', 'nim'
          ];
          if (known.includes(cls.toLowerCase())) {
            detectedLang = cls.toLowerCase();
            break;
          }
        }
      }

      // Tag the DOM element for source highlighting
      try {
        el.setAttribute('data-xplainify-src', `code-${results.length + 1}`);
      } catch (_) {}

      results.push({
        code: text.substring(0, 10000), // Cap single block to protect memory
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
