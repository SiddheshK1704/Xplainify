/**
 * Xplainify — Gemini API Client
 * Dynamic Model Discovery · Local 6-Hour Caching · Header-Based Key Transport · Bounded Retries
 */

import { getCachedModel, setCachedModel, invalidateCachedModel } from './storage.js';

export { getCachedModel, setCachedModel, invalidateCachedModel };

const API_VERSION = 'v1beta';
const BASE_URL = 'https://generativelanguage.googleapis.com';
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// Fallbacks if Models API is temporarily unreachable during first run
const DEFAULT_FALLBACK_SUMMARY_MODEL = 'gemini-2.0-flash-lite';
const DEFAULT_FALLBACK_CODE_MODEL = 'gemini-1.5-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-flash';

/**
 * Standardized Error class for Gemini API interactions.
 */
export class GeminiApiError extends Error {
  constructor(message, {
    status = null,
    isAuth = false,
    isMissingKey = false,
    isTimeout = false,
    isNetwork = false,
    isSafety = false,
    isEmpty = false,
    finishReason = null,
    apiDetail = ''
  } = {}) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.isAuth = isAuth;
    this.isMissingKey = isMissingKey;
    this.isTimeout = isTimeout;
    this.isNetwork = isNetwork;
    this.isSafety = isSafety;
    this.isEmpty = isEmpty;
    this.finishReason = finishReason;
    this.apiDetail = apiDetail;
  }
}

/**
 * Fetches all models available to the provided API key, handling pagination.
 * Transport uses x-goog-api-key header; never puts key in URL query string.
 * @param {string} apiKey 
 * @returns {Promise<Array<Object>>}
 */
export async function listAvailableModels(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new GeminiApiError('No Gemini API key configured. Please set up your API key in Settings.', { isAuth: true, isMissingKey: true, status: 401 });
  }

  const cleanKey = apiKey.trim();
  let models = [];
  let pageToken = '';
  let pagesFetched = 0;
  const maxPages = 5; // Guard against infinite pagination loops

  while (pagesFetched < maxPages) {
    let url = `${BASE_URL}/${API_VERSION}/models`;
    if (pageToken) {
      url += `?pageToken=${encodeURIComponent(pageToken)}`;
    }

    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': cleanKey
        }
      }, 15000);
    } catch (err) {
      if (pagesFetched > 0 && models.length > 0) {
        // Return whatever was already fetched if subsequent page fails
        break;
      }
      throw err;
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.error) {
          detail = errorJson.error.message || '';
        }
      } catch {}
      const isAuth = response.status === 401 ||
                     response.status === 403 ||
                     detail.toLowerCase().includes('api key') ||
                     detail.toLowerCase().includes('key not valid') ||
                     detail.toLowerCase().includes('api_key_invalid');
      throw new GeminiApiError(detail ? `Models API HTTP ${response.status}: ${detail}` : `Models API HTTP ${response.status}`, {
        status: response.status,
        apiDetail: detail,
        isAuth
      });
    }

    const data = await response.json();
    if (data && Array.isArray(data.models)) {
      models.push(...data.models);
    }

    if (data && data.nextPageToken) {
      pageToken = data.nextPageToken;
      pagesFetched++;
    } else {
      break;
    }
  }

  return models;
}

/**
 * Checks if a model belongs to the Flash-Lite or lightweight family.
 */
function isLiteModel(name) {
  const n = (name || '').toLowerCase();
  return n.includes('lite') || n.includes('8b');
}

/**
 * Filters and ranks models.
 * For summary purpose: prioritizes Flash-Lite (raw speed and low TTFT) -> Flash.
 * For code or default: prioritizes highest version stable Flash.
 * Excludes preview, experimental, thinking, and specialized non-text models.
 * @param {Array<Object>} models 
 * @param {string|null} purpose 'summary' | 'code' | null
 * @returns {string|null}
 */
export function filterAndRankFlashModels(models, purpose = null) {
  if (!Array.isArray(models) || models.length === 0) return null;

  const suitableModels = models.filter(m => {
    if (!m || !m.name) return false;
    const name = m.name.toLowerCase();

    // 1. Must support generateContent
    const methods = m.supportedGenerationMethods || [];
    if (!methods.includes('generateContent')) return false;

    // 2. Must be in the Flash family
    if (!name.includes('flash')) return false;

    // 3. Exclude preview, experimental, thinking, and test models
    if (name.includes('preview') || 
        name.includes('exp') || 
        name.includes('experimental') || 
        name.includes('thinking') || 
        name.includes('test')) {
      return false;
    }

    // 4. Exclude non-text, embedding, audio, or live-only models
    if (name.includes('embedding') || 
        name.includes('aqa') || 
        name.includes('live') || 
        name.includes('imagen') || 
        name.includes('vision-only')) {
      return false;
    }

    return true;
  });

  if (suitableModels.length === 0) {
    // Graceful fallback: If strict filter eliminated all, allow standard Flash models
    const relaxed = models.filter(m => {
      const name = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && name.includes('flash');
    });
    if (relaxed.length > 0) {
      return cleanModelName(relaxed[0].name);
    }
    return null;
  }

  // Rank deterministically
  suitableModels.sort((a, b) => {
    const isLiteA = isLiteModel(a.name);
    const isLiteB = isLiteModel(b.name);
    const versionA = extractModelVersion(a.name);
    const versionB = extractModelVersion(b.name);

    if (purpose === 'summary') {
      // Prioritize lightweight Flash models first for maximum summarization speed
      if (isLiteA && !isLiteB) return -1;
      if (!isLiteA && isLiteB) return 1;
      return versionB - versionA;
    } else {
      // Prioritize standard full Flash models for code reasoning or default ranking
      if (!isLiteA && isLiteB) return -1;
      if (isLiteA && !isLiteB) return 1;
      return versionB - versionA;
    }
  });

  return cleanModelName(suitableModels[0].name);
}

/**
 * Extracts a numeric version score from model name.
 * e.g., "models/gemini-2.5-flash" -> 2.5, "models/gemini-1.5-flash-latest" -> 1.51
 */
function extractModelVersion(modelName) {
  if (!modelName) return 0;
  const match = modelName.match(/gemini-(\d+(?:\.\d+)?)/i);
  let baseScore = match ? parseFloat(match[1]) : 1.0;
  if (modelName.toLowerCase().includes('latest')) {
    baseScore += 0.01;
  }
  return baseScore;
}

/**
 * Strips 'models/' prefix for standard API endpoint usage.
 */
function cleanModelName(rawName) {
  if (!rawName) return DEFAULT_FALLBACK_MODEL;
  return rawName.replace(/^models\//, '').trim();
}

/**
 * Resolves the best Gemini model available to the user's API key.
 * Uses local storage caching with a 6-hour TTL to eliminate redundant Models API calls.
 * @param {string} apiKey 
 * @param {boolean} forceRefresh 
 * @param {string} purpose 'summary' | 'code'
 * @returns {Promise<string>}
 */
export async function resolveBestGeminiModel(apiKey, forceRefresh = false, purpose = 'summary') {
  if (!forceRefresh) {
    try {
      const cached = await getCachedModel(purpose);
      if (cached && cached.modelName && cached.resolvedAt) {
        const age = Date.now() - cached.resolvedAt;
        if (age < MODEL_CACHE_TTL_MS) {
          return cached.modelName;
        }
      }
    } catch {
      // Ignore cache read error and proceed
    }
  }

  try {
    const available = await listAvailableModels(apiKey);
    const selected = filterAndRankFlashModels(available, purpose);

    if (selected) {
      await setCachedModel(selected, purpose);
      return selected;
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403 || err.isAuth) {
      throw err;
    }
    console.warn('[Xplainify][Model] Dynamic discovery notice, falling back to default:', err.message);
  }

  // Fallback to purpose-specific default model
  const fallback = purpose === 'summary' ? DEFAULT_FALLBACK_SUMMARY_MODEL : DEFAULT_FALLBACK_CODE_MODEL;
  await setCachedModel(fallback, purpose);
  return fallback;
}

/**
 * Executes a fetch request with timeout protection via AbortController.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutErr = new Error('The request took too long. Please try again.');
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    const netErr = new Error('Network error');
    netErr.isNetwork = true;
    netErr.originalMessage = error.message;
    throw netErr;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Validates whether a summary output contains the expected sections
 * and does not terminate abruptly on a dangling heading.
 * Supports standard TL;DR / Key Points / Explain It Simply format.
 * @param {string} text 
 * @returns {boolean}
 */
export function isSummaryComplete(text) {
  if (!text || typeof text !== 'string') return false;
  const upper = text.toUpperCase();
  const hasSummary = upper.includes('TL;DR') || upper.includes('TLDR') || upper.includes('SUMMARY');
  const hasKeyPoints = upper.includes('KEY POINTS') || upper.includes('KEY TAKEAWAYS');
  const hasTakeaway = upper.includes('EXPLAIN IT SIMPLY') || upper.includes('TAKEAWAY') || upper.includes('ACTIONABLE');
  const endsDangling = /###\s*[\w\s;:]+:\s*$/i.test(text.trim()) || /-\s*[\w\s]+:\s*$/i.test(text.trim());
  return hasSummary && hasKeyPoints && hasTakeaway && !endsDangling;
}

/**
 * Primary function to call Gemini generateContent.
 * Handles self-healing retries, 404 model recovery, multi-part candidate concatenation,
 * and completeness validation with bounded recovery.
 * Key transport uses x-goog-api-key header; never logged or passed in query strings.
 * @param {string} apiKey 
 * @param {string} prompt 
 * @param {string} purpose 'summary' | 'code'
 * @returns {Promise<string>}
 */
export async function callGemini(apiKey, prompt, purpose = 'summary') {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new GeminiApiError('No Gemini API key configured. Please set up your API key in Settings.', { isAuth: true, isMissingKey: true, status: 401 });
  }

  const cleanKey = apiKey.trim();
  const maxOutputTokens = purpose === 'summary' ? 1400 : 1600;
  const requestBody = JSON.stringify({
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      maxOutputTokens,
      temperature: 0.2
    }
  });

  // Resolve model from local cache (or Models API if missing/expired)
  let activeModel;
  try {
    activeModel = await resolveBestGeminiModel(cleanKey, false, purpose);
  } catch (resolveErr) {
    throw normalizeGeminiError(resolveErr);
  }

  let result;
  // Attempt generation with strictly bounded recovery
  try {
    result = await executeGenerateRequest(cleanKey, activeModel, requestBody);
  } catch (firstErr) {
    // 1. If 404: model deprecated or unavailable -> invalidate cache, re-resolve once, retry once
    if (firstErr.status === 404) {
      console.warn(`[Xplainify][Model] Model "${activeModel}" returned 404. Re-resolving models and retrying once...`);
      await invalidateCachedModel(purpose);
      try {
        activeModel = await resolveBestGeminiModel(cleanKey, true, purpose);
        result = await executeGenerateRequest(cleanKey, activeModel, requestBody);
      } catch (retryErr) {
        throw normalizeGeminiError(retryErr);
      }
    } else if (firstErr.status >= 500 && firstErr.status < 600) {
      // 2. If 5xx: temporary server outage -> wait 1000ms and retry once
      console.warn(`[Xplainify][API] Server returned HTTP ${firstErr.status}. Retrying after 1000ms...`);
      await delay(1000);
      try {
        result = await executeGenerateRequest(cleanKey, activeModel, requestBody);
        console.info('[Xplainify][API] Server retry succeeded.');
      } catch (retryErr) {
        console.error('[Xplainify][API] Server error persisted on retry:', retryErr.message || retryErr);
        throw normalizeGeminiError(retryErr);
      }
    } else if (firstErr.isNetwork && !firstErr.isTimeout) {
      // 3. If transient network error (not timeout): wait 500ms and retry once
      console.warn('[Xplainify][API] Transient network error encountered. Retrying after 500ms...');
      await delay(500);
      try {
        result = await executeGenerateRequest(cleanKey, activeModel, requestBody);
        console.info('[Xplainify][API] Network retry succeeded.');
      } catch (retryErr) {
        throw normalizeGeminiError(retryErr);
      }
    } else {
      throw normalizeGeminiError(firstErr);
    }
  }

  // Completeness check for summaries: if finishReason is MAX_TOKENS or structure is cut off, run 1 bounded continuation
  if (purpose === 'summary' && (result.finishReason === 'MAX_TOKENS' || !isSummaryComplete(result.text))) {
    console.warn(`[Xplainify][API] Summary incomplete (finishReason: ${result.finishReason}). Running bounded completion...`);
    try {
      const continuationPrompt = `${prompt}\n\n[PREVIOUS TRUNCATED OUTPUT]:\n${result.text}\n\n[TASK]: Provide the complete missing remainder starting from where it cut off. Ensure the KEY POINTS and TAKEAWAY sections are completely concluded. Do not repeat what was already written.`;
      const contBody = JSON.stringify({
        contents: [{ parts: [{ text: continuationPrompt }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.2 }
      });
      const contResult = await executeGenerateRequest(cleanKey, activeModel, contBody);
      if (contResult && contResult.text) {
        result.text = `${result.text}\n\n${contResult.text}`.trim();
      }
    } catch (contErr) {
      console.warn('[Xplainify][API] Continuation recovery notice:', contErr.message);
    }
  }

  return result.text;
}

/**
 * Sends the POST request to generateContent with AbortController timeout and header key transport.
 * Concatenates all candidate text parts to prevent mid-response cutoffs.
 */
async function executeGenerateRequest(apiKey, modelName, body) {
  const endpoint = `${BASE_URL}/${API_VERSION}/models/${modelName}:generateContent`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    let detail = '';
    try {
      const errorJson = await response.json();
      if (errorJson && errorJson.error) {
        detail = errorJson.error.message || '';
      }
    } catch {}
    const isAuth = detail.toLowerCase().includes('api key') ||
                   detail.toLowerCase().includes('key not valid') ||
                   response.status === 401 ||
                   response.status === 403;
    throw new GeminiApiError(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`, {
      status: response.status,
      apiDetail: detail,
      isAuth
    });
  }

  const data = await response.json();

  // Validate nested response structure thoroughly
  if (
    !data ||
    !data.candidates ||
    !Array.isArray(data.candidates) ||
    data.candidates.length === 0
  ) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw new GeminiApiError('Content blocked by safety policy.', { isSafety: true });
    }
    throw new GeminiApiError('Empty or unexpected response structure from Gemini.', { isEmpty: true });
  }

  const candidate = data.candidates[0];
  const finishReason = candidate.finishReason || null;

  if (finishReason === 'SAFETY') {
    throw new GeminiApiError('Content blocked by safety policy.', { isSafety: true, finishReason });
  }

  const parts = candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  // CRITICAL: Concatenate ALL text parts to avoid dropping tokens when Gemini chunks output
  const fullText = parts
    .filter(p => p && typeof p.text === 'string')
    .map(p => p.text)
    .join('');

  const trimmedText = fullText.trim();
  if (trimmedText.length === 0) {
    throw new GeminiApiError('Empty response text from Gemini.', { isEmpty: true, finishReason });
  }

  return {
    text: trimmedText,
    finishReason,
    candidate
  };
}

/**
 * Normalizes any error into clean, user-friendly copy without leaking keys or raw stack traces.
 * @param {Error} err 
 * @returns {GeminiApiError}
 */
export function normalizeGeminiError(err) {
  // (a) Missing API Key
  if (err.isMissingKey || (err.message && err.message.includes('No Gemini API key'))) {
    return new GeminiApiError('No Gemini API key configured. Please set up your API key in Settings.', {
      status: 401,
      isAuth: true,
      isMissingKey: true
    });
  }

  // (d) Network failures & Timeouts
  if (err.isTimeout) {
    return new GeminiApiError('Request timed out. Gemini took too long to respond. Please try again.', { isTimeout: true });
  }

  if (err.isNetwork) {
    return new GeminiApiError('Unable to connect to Gemini. Check your internet connection and try again.', { isNetwork: true });
  }

  const msg = (err.message || '').toLowerCase();
  const detail = (err.apiDetail || '').toLowerCase();

  // (b) Invalid / Expired API key (401 / 403)
  if (
    err.isAuth || 
    err.status === 401 || 
    err.status === 403 || 
    msg.includes('401') || 
    msg.includes('403') || 
    msg.includes('api key') || 
    msg.includes('api_key_invalid') ||
    msg.includes('key not valid') ||
    detail.includes('api key') ||
    detail.includes('key not valid') ||
    detail.includes('api_key_invalid') ||
    detail.includes('permission_denied') ||
    msg.includes('unauthorized') ||
    msg.includes('unauthenticated')
  ) {
    return new GeminiApiError('Your Gemini API key is invalid or expired. Please check your key in Settings.', {
      status: 401,
      isAuth: true
    });
  }

  // (c) Rate Limiting (429)
  if (
    err.status === 429 || 
    msg.includes('429') || 
    msg.includes('quota') || 
    msg.includes('resource_exhausted') || 
    msg.includes('rate limit') ||
    detail.includes('resource_exhausted') ||
    detail.includes('quota')
  ) {
    return new GeminiApiError('Gemini API rate limit exceeded. Please wait a moment before trying again.', {
      status: 429
    });
  }

  // Model unavailable (404)
  if (err.status === 404) {
    return new GeminiApiError('The requested AI model is currently unavailable. Please try again.', { status: 404 });
  }

  // Server error (5xx)
  if (err.status >= 500 && err.status < 600) {
    return new GeminiApiError('Google Gemini servers are temporarily unavailable. Please try again shortly.', { status: err.status });
  }

  // Safety block
  if (err.isSafety) {
    return new GeminiApiError('Content could not be summarized due to Gemini safety restrictions.', { isSafety: true });
  }

  // (e) Empty or malformed response
  if (err.isEmpty || msg.includes('empty') || msg.includes('malformed')) {
    return new GeminiApiError('Gemini returned an empty or malformed response. Please try again.', { isEmpty: true });
  }

  console.error('[Xplainify][API] Error notice:', err.message || err);
  return new GeminiApiError('Something went wrong while communicating with Gemini. Please try again.');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

