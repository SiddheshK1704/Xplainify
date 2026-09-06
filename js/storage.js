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
    chrome.storage.local.remove('gemini_api_key', () => {
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
