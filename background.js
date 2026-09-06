import { saveContextMenuCode, clearContextMenuCode } from './js/storage.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'xplainify-explain-code',
    title: 'Xplainify → Explain Selected Code',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'xplainify-explain-code') {
    const selectedText = info.selectionText;
    if (selectedText) {
      saveContextMenuCode(selectedText).then(() => {
        chrome.action.setBadgeText({ text: '1' });
        chrome.action.setBadgeBackgroundColor({ color: '#4274D9' });
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'clear-badge') {
    chrome.action.setBadgeText({ text: '' });
  }
});
