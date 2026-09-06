export function saveApiKey(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ 'gemini_api_key': key }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export function getApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['gemini_api_key'], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result.gemini_api_key || null);
      }
    });
  });
}

export function removeApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(['gemini_api_key', 'cached_gemini_model'], () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export function getCachedModel(purpose = 'summary') {
  const key = `cached_gemini_model_${purpose}`;
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key, 'cached_gemini_model'], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result[key] || result.cached_gemini_model || null);
      }
    });
  });
}

export function setCachedModel(modelName, purpose = 'summary') {
  const key = `cached_gemini_model_${purpose}`;
  return new Promise((resolve, reject) => {
    const data = {
      modelName,
      resolvedAt: Date.now(),
      purpose
    };
    chrome.storage.local.set({ [key]: data }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(data);
      }
    });
  });
}

export function invalidateCachedModel(purpose = null) {
  return new Promise((resolve, reject) => {
    const keys = purpose 
      ? [`cached_gemini_model_${purpose}`]
      : ['cached_gemini_model_summary', 'cached_gemini_model_code', 'cached_gemini_model'];
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export async function hasApiKey() {
  const key = await getApiKey();
  return Boolean(key);
}

export async function getMaskedKey() {
  const key = await getApiKey();
  if (!key) return null;
  return '••••••••••••••••••••';
}

export function saveContextMenuCode(code) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ 'context_menu_code': code }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

export function getContextMenuCode() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['context_menu_code'], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result.context_menu_code || null);
      }
    });
  });
}

export function clearContextMenuCode() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove('context_menu_code', () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}
