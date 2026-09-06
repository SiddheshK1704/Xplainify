import { saveApiKey, getApiKey, removeApiKey, hasApiKey, getMaskedKey } from './js/storage.js';

// DOM Elements
const stateKeySetup = document.getElementById('key-setup');
const stateKeySaved = document.getElementById('key-saved');
const stateKeyUpdate = document.getElementById('key-update');

const apiKeyInput = document.getElementById('api-key-input');
const updateKeyInput = document.getElementById('update-key-input');
const maskedKeyDisplay = document.getElementById('masked-key-display');

const saveKeyBtn = document.getElementById('save-key-btn');
const getKeyBtn = document.getElementById('get-key-btn');
const updateKeyBtn = document.getElementById('update-key-btn');
const removeKeyBtn = document.getElementById('remove-key-btn');
const saveUpdateBtn = document.getElementById('save-update-btn');
const cancelUpdateBtn = document.getElementById('cancel-update-btn');

const confirmDialog = document.getElementById('confirm-dialog');
const confirmRemoveBtn = document.getElementById('confirm-remove-btn');
const cancelRemoveBtn = document.getElementById('cancel-remove-btn');
const portfolioLink = document.getElementById('portfolio-link');

let toastContainer = null;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupToastContainer();
  await updateState();
  
  // Event Listeners
  saveKeyBtn.addEventListener('click', handleSaveKey);
  updateKeyBtn.addEventListener('click', handleUpdateKey);
  saveUpdateBtn.addEventListener('click', handleSaveUpdate);
  cancelUpdateBtn.addEventListener('click', handleCancelUpdate);
  removeKeyBtn.addEventListener('click', handleRemoveKey);
  confirmRemoveBtn.addEventListener('click', handleConfirmRemove);
  cancelRemoveBtn.addEventListener('click', handleCancelRemove);
  
  getKeyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/api-keys' });
  });
  
  portfolioLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://siddheshk17-portfolio.vercel.app/' });
  });

  // Enter key support
  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSaveKey();
  });
  updateKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSaveUpdate();
  });
}

function setupToastContainer() {
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
}

async function updateState() {
  const hasKey = await hasApiKey();
  if (hasKey) {
    const maskedKey = await getMaskedKey();
    maskedKeyDisplay.textContent = maskedKey;
    showState('key-saved');
  } else {
    showState('key-setup');
  }
}

function showState(stateName) {
  stateKeySetup.style.display = 'none';
  stateKeySaved.style.display = 'none';
  stateKeyUpdate.style.display = 'none';

  if (stateName === 'key-setup') {
    stateKeySetup.style.display = 'block';
  } else if (stateName === 'key-saved') {
    stateKeySaved.style.display = 'block';
  } else if (stateName === 'key-update') {
    stateKeyUpdate.style.display = 'block';
    updateKeyInput.focus();
  }
}

async function handleSaveKey() {
  const key = apiKeyInput.value.trim();
  if (validateKey(key)) {
    await saveApiKey(key);
    apiKeyInput.value = '';
    showToast('API key saved successfully', 'success');
    await updateState();
  }
}

function handleUpdateKey() {
  showState('key-update');
}

async function handleSaveUpdate() {
  const key = updateKeyInput.value.trim();
  if (validateKey(key)) {
    await saveApiKey(key);
    updateKeyInput.value = '';
    showToast('API key updated successfully', 'success');
    await updateState();
  }
}

function handleCancelUpdate() {
  updateKeyInput.value = '';
  showState('key-saved');
}

function handleRemoveKey() {
  confirmDialog.style.display = 'flex';
}

async function handleConfirmRemove() {
  await removeApiKey();
  confirmDialog.style.display = 'none';
  showToast('API key removed', 'success');
  await updateState();
}

function handleCancelRemove() {
  confirmDialog.style.display = 'none';
}

function validateKey(key) {
  if (!key) {
    showToast('Please enter an API key', 'error');
    return false;
  }
  if (key.length < 10) {
    showToast('Invalid API key format. Key is too short.', 'error');
    return false;
  }
  return true;
}

function showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  // Remove after animation finishes
  setTimeout(() => {
    if (toastContainer.contains(toast)) {
      toastContainer.removeChild(toast);
    }
  }, 3000);
}
