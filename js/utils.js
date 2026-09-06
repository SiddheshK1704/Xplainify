/**
 * Xplainify — Safe Utilities & DOM Renderer
 * Safe rendering without innerHTML, clipboard helpers, language normalization.
 */

/**
 * Escapes HTML characters safely.
 * @param {string} text 
 * @returns {string}
 */
export function sanitize(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Safely parses and renders Markdown-like AI output into container using DOM creation.
 * Never executes code or injects raw unsanitized HTML.
 * @param {HTMLElement} container 
 * @param {string} text 
 */
export function renderResultSafe(container, text) {
  if (!container) return;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (!text || typeof text !== 'string') {
    const emptyP = document.createElement('p');
    emptyP.className = 'result-empty-text';
    emptyP.textContent = 'No content available.';
    container.appendChild(emptyP);
    return;
  }

  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBlockLang = '';
  let currentCodeContent = [];
  let currentList = null;
  let isNumberedList = false;
  let listCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Code block delimiters
    if (trimmedLine.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        inCodeBlock = false;
        const codeWrapper = document.createElement('div');
        codeWrapper.className = 'result-code-wrapper';

        if (codeBlockLang) {
          const codeHeader = document.createElement('div');
          codeHeader.className = 'result-code-header';
          
          const langTag = document.createElement('span');
          langTag.className = 'result-code-lang';
          langTag.textContent = codeBlockLang;
          codeHeader.appendChild(langTag);

          const copySnippetBtn = document.createElement('button');
          copySnippetBtn.className = 'result-code-copy-btn';
          copySnippetBtn.textContent = 'Copy';
          const codeToCopy = currentCodeContent.join('\n');
          copySnippetBtn.addEventListener('click', () => {
            copyToClipboard(codeToCopy);
            copySnippetBtn.textContent = '✓ Copied';
            setTimeout(() => {
              copySnippetBtn.textContent = 'Copy';
            }, 1800);
          });
          codeHeader.appendChild(copySnippetBtn);
          codeWrapper.appendChild(codeHeader);
        }

        const pre = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.textContent = currentCodeContent.join('\n');
        pre.appendChild(codeEl);
        codeWrapper.appendChild(pre);
        container.appendChild(codeWrapper);

        currentCodeContent = [];
        codeBlockLang = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        codeBlockLang = trimmedLine.replace(/^```+/, '').trim() || 'Code';
        currentCodeContent = [];
        currentList = null;
      }
      continue;
    }

    if (inCodeBlock) {
      currentCodeContent.push(line);
      continue;
    }

    // Empty line
    if (!trimmedLine) {
      currentList = null;
      continue;
    }

    // Horizontal Rule
    if (trimmedLine === '---' || trimmedLine === '***' || trimmedLine === '___') {
      currentList = null;
      const hr = document.createElement('hr');
      hr.className = 'result-divider';
      container.appendChild(hr);
      continue;
    }

    // Headings (### or ## or #)
    const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      currentList = null;
      const headingLevel = headingMatch[1].length;
      const headingText = headingMatch[2];

      const headingEl = document.createElement('h3');
      headingEl.className = `result-heading level-${headingLevel}`;
      
      // Check for prominent section keywords
      const upper = headingText.toUpperCase();
      if (upper.includes('TL;DR') || upper.includes('KEY POINTS') || upper.includes('EXPLAIN IT SIMPLY') || upper.includes('WHAT DOES THIS CODE DO') || upper.includes('LOGIC') || upper.includes('IMPORTANT LINES') || upper.includes('CONCEPTS')) {
        headingEl.classList.add('section-highlight');
      }

      headingEl.textContent = headingText;
      container.appendChild(headingEl);
      continue;
    }

    // Numbered list item: 1. or 01. or 1)
    const numberedMatch = trimmedLine.match(/^(\d{1,2})[\.\)]\s+(.+)$/);
    if (numberedMatch) {
      if (!currentList || !isNumberedList) {
        currentList = document.createElement('ol');
        currentList.className = 'result-numbered-list';
        container.appendChild(currentList);
        isNumberedList = true;
        listCounter = 0;
      }
      listCounter++;
      const li = document.createElement('li');
      li.className = 'result-list-item numbered';
      li.dataset.step = String(listCounter).padStart(2, '0');
      parseFormattedInline(li, numberedMatch[2]);
      currentList.appendChild(li);
      continue;
    }

    // Bulleted list item: - or *
    const bulletMatch = trimmedLine.match(/^[\-\*]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentList || isNumberedList) {
        currentList = document.createElement('ul');
        currentList.className = 'result-bullet-list';
        container.appendChild(currentList);
        isNumberedList = false;
      }
      const li = document.createElement('li');
      li.className = 'result-list-item bullet';
      parseFormattedInline(li, bulletMatch[1]);
      currentList.appendChild(li);
      continue;
    }

    // Concept tags line: e.g. [Functions] [Classes] [Async/Await]
    if (isConceptTagsLine(trimmedLine)) {
      currentList = null;
      const tagRow = document.createElement('div');
      tagRow.className = 'result-tags-row';
      const tagMatches = trimmedLine.match(/\[([^\]]+)\]/g) || [];
      tagMatches.forEach(tag => {
        const cleanTag = tag.replace(/[\[\]]/g, '').trim();
        if (cleanTag) {
          const badge = document.createElement('span');
          badge.className = 'result-concept-tag';
          badge.textContent = cleanTag;
          tagRow.appendChild(badge);
        }
      });
      container.appendChild(tagRow);
      continue;
    }

    // Execution flow indicator: ↓ or ->
    if (trimmedLine === '↓' || trimmedLine === '|' || trimmedLine === 'v') {
      currentList = null;
      const arrow = document.createElement('div');
      arrow.className = 'result-flow-arrow';
      arrow.textContent = '↓';
      container.appendChild(arrow);
      continue;
    }

    // Regular paragraph
    currentList = null;
    const p = document.createElement('p');
    p.className = 'result-paragraph';
    parseFormattedInline(p, trimmedLine);
    container.appendChild(p);
  }
}

/**
 * Checks if a line is composed mostly of bracketed concept tags e.g. [Functions] [Loops]
 * @param {string} line 
 * @returns {boolean}
 */
function isConceptTagsLine(line) {
  const brackets = line.match(/\[[^\]]+\]/g);
  if (!brackets || brackets.length === 0) return false;
  const stripped = line.replace(/\[[^\]]+\]/g, '').replace(/[\s,·\-\|]/g, '');
  return stripped.length === 0;
}

/**
 * Parses inline formatting: **bold**, `code`, *italic* safely into an element.
 * @param {HTMLElement} element 
 * @param {string} text 
 */
function parseFormattedInline(element, text) {
  // Tokenize by inline code (`...`), bold (**...**), and italic (*...*)
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  for (const token of tokens) {
    if (!token) continue;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      const code = document.createElement('code');
      code.className = 'result-inline-code';
      code.textContent = token.substring(1, token.length - 1);
      element.appendChild(code);
    } else if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      const strong = document.createElement('strong');
      strong.className = 'result-bold';
      strong.textContent = token.substring(2, token.length - 2);
      element.appendChild(strong);
    } else if (token.startsWith('*') && token.endsWith('*') && token.length >= 2 && !token.startsWith('**')) {
      const em = document.createElement('em');
      em.className = 'result-italic';
      em.textContent = token.substring(1, token.length - 1);
      element.appendChild(em);
    } else {
      element.appendChild(document.createTextNode(token));
    }
  }
}

/**
 * Copies string to clipboard with fallback.
 * @param {string} text 
 * @returns {Promise<boolean>}
 */
export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return Promise.resolve(success);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Normalizes language class / string into human-readable label.
 * @param {string} langClass 
 * @returns {string}
 */
export function formatLanguage(langClass) {
  if (!langClass) return 'Code';
  const match = langClass.match(/language-([a-zA-Z0-9+#]+)/i) || langClass.match(/lang-([a-zA-Z0-9+#]+)/i) || [null, langClass];
  let lang = (match[1] || langClass).toLowerCase().trim();
  
  const map = {
    'python': 'Python',
    'py': 'Python',
    'js': 'JavaScript',
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'ts': 'TypeScript',
    'java': 'Java',
    'cpp': 'C++',
    'c++': 'C++',
    'c': 'C',
    'csharp': 'C#',
    'c#': 'C#',
    'cs': 'C#',
    'go': 'Go',
    'golang': 'Go',
    'rust': 'Rust',
    'rs': 'Rust',
    'php': 'PHP',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'sql': 'SQL',
    'bash': 'Bash',
    'sh': 'Bash',
    'shell': 'Bash',
    'zsh': 'Zsh',
    'ruby': 'Ruby',
    'rb': 'Ruby',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'kt': 'Kotlin',
    'r': 'R',
    'dart': 'Dart',
    'yaml': 'YAML',
    'yml': 'YAML',
    'json': 'JSON',
    'xml': 'XML',
    'markdown': 'Markdown',
    'md': 'Markdown'
  };

  if (map[lang]) return map[lang];

  lang = lang.replace(/^language-|^lang-/, '');
  if (lang.length > 0) {
    return lang.charAt(0).toUpperCase() + lang.slice(1);
  }
  return 'Code';
}
