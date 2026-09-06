# Xplainify — Privacy Policy

**Last updated: September 2026**

## Overview

Xplainify is a Chrome extension that summarizes webpages and explains code using Google's Gemini API. This document explains how Xplainify handles your data.

## No Backend

Xplainify does not operate a backend server for AI requests or any other purpose. All AI requests are made directly from your browser to Google's Gemini API.

## API Key Storage

Your Gemini API key is stored locally on your device using Chrome's extension storage API (`chrome.storage.local`). Your API key is:
- Stored only on your device
- Never transmitted to Xplainify servers (there are none)
- Never logged or included in error messages
- Never shared with third parties by Xplainify
- Removable at any time through the extension's Settings page

## Data Sent to Google Gemini

When you use Xplainify's AI features, the following data is sent directly to Google's Gemini API:
- **Webpage Summarization**: Extracted text content from the current webpage (cleaned and truncated)
- **Code Explanation**: The selected code block from the current webpage

This data is sent only when you explicitly click "Summarize Page" or "Explain Code". Xplainify does not automatically send any data.

## Data NOT Collected

Xplainify does not intentionally collect:
- Browsing history
- Personal information
- Usage analytics
- Cookies
- IP addresses
- Device information

## Third-Party Services

Xplainify uses Google's Gemini API. Data sent to Gemini is subject to Google's terms and privacy policies. We encourage you to review:
- [Google's Terms of Service](https://policies.google.com/terms)
- [Google's Privacy Policy](https://policies.google.com/privacy)
- [Gemini API Terms](https://ai.google.dev/gemini-api/terms)

## Permissions

Xplainify requests minimal Chrome permissions:
- **activeTab**: To read the content of the page you're currently viewing (only when you click the extension)
- **scripting**: To inject content extraction scripts into the active tab
- **storage**: To store your API key locally
- **contextMenus**: To add a right-click option for explaining selected code

## Changes to This Policy

Any changes to this privacy policy will be reflected in this document with an updated date.

## Contact

For questions or concerns, visit [the developer's portfolio](https://siddheshk17-portfolio.vercel.app/).
