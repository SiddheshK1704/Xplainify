export function sanitize(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

export function renderResultSafe(container, text) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const lines = text.split('\n');
  let inCodeBlock = false;
  let currentCodeContent = [];
  let currentList = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = currentCodeContent.join('\n');
        pre.appendChild(code);
        container.appendChild(pre);
        currentCodeContent = [];
      } else {
        inCodeBlock = true;
        currentCodeContent = [];
        currentList = null;
      }
      continue;
    }

    if (inCodeBlock) {
      currentCodeContent.push(line);
      continue;
    }

    const trimmedLine = line.trim();
    if (!trimmedLine) {
      currentList = null;
      continue;
    }

    if (trimmedLine.startsWith('### ')) {
      currentList = null;
      const h3 = document.createElement('h3');
      h3.textContent = trimmedLine.substring(4);
      container.appendChild(h3);
    } else if (trimmedLine.startsWith('- ')) {
      if (!currentList) {
        currentList = document.createElement('ul');
        container.appendChild(currentList);
      }
      const li = document.createElement('li');
      parseBoldText(li, trimmedLine.substring(2));
      currentList.appendChild(li);
    } else {
      currentList = null;
      const p = document.createElement('p');
      parseBoldText(p, trimmedLine);
      container.appendChild(p);
    }
  }
}

function parseBoldText(element, text) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const strong = document.createElement('strong');
      strong.textContent = part.substring(2, part.length - 2);
      element.appendChild(strong);
    } else if (part) {
      element.appendChild(document.createTextNode(part));
    }
  }
}

export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

export function formatLanguage(langClass) {
  if (!langClass) return 'Code';
  const match = langClass.match(/language-([a-zA-Z0-9+#]+)/i) || langClass.match(/lang-([a-zA-Z0-9+#]+)/i) || [null, langClass];
  let lang = match[1] || langClass;
  lang = lang.toLowerCase();
  
  const map = {
    'python': 'Python',
    'js': 'JavaScript',
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'ts': 'TypeScript',
    'java': 'Java',
    'cpp': 'C++',
    'c++': 'C++',
    'csharp': 'C#',
    'c#': 'C#',
    'go': 'Go',
    'rust': 'Rust',
    'php': 'PHP',
    'html': 'HTML',
    'css': 'CSS',
    'sql': 'SQL',
    'bash': 'Bash',
    'shell': 'Bash',
    'ruby': 'Ruby',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'r': 'R'
  };

  if (map[lang]) return map[lang];

  lang = lang.replace(/^language-|^lang-/, '');
  if (lang.length > 0) {
    return lang.charAt(0).toUpperCase() + lang.slice(1);
  }
  return 'Code';
}
