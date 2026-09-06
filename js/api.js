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

// Fallback if Models API is temporarily unreachable during first run
const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-flash';

/**
 * Fetches all models available to the provided API key, handling pagination.
 * Transport uses x-goog-api-key header; never puts key in URL query string.
 * @param {string} apiKey 
 * @returns {Promise<Array<Object>>}
 */
export async function listAvailableModels(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('API key is required to query available models.');
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
      const err = new Error(detail ? `Models API HTTP ${response.status}: ${detail}` : `Models API HTTP ${response.status}`);
      err.status = response.status;
      if (detail.toLowerCase().includes('api key') || detail.toLowerCase().includes('key not valid')) {
        err.isAuth = true;
      }
      throw err;
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
 * Filters and ranks models to deterministically select the newest, stable Flash model.
 * Excludes preview, experimental, thinking, and specialized non-text models.
 * @param {Array<Object>} models 
 * @returns {string|null}
 */
export function filterAndRankFlashModels(models) {
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

  // Rank by numeric version score (e.g. gemini-2.5-flash > gemini-2.0-flash > gemini-1.5-flash)
  suitableModels.sort((a, b) => {
    const versionA = extractModelVersion(a.name);
    const versionB = extractModelVersion(b.name);
    return versionB - versionA;
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
 * @returns {Promise<string>}
 */
export async function resolveBestGeminiModel(apiKey, forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = await getCachedModel();
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
    const selected = filterAndRankFlashModels(available);

    if (selected) {
      await setCachedModel(selected);
      return selected;
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      throw err;
    }
    console.warn('[Xplainify][Model] Dynamic discovery notice, falling back to default:', err.message);
  }

  // Fallback to default Flash model
  await setCachedModel(DEFAULT_FALLBACK_MODEL);
  return DEFAULT_FALLBACK_MODEL;
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
 * Primary function to call Gemini generateContent.
 * Handles self-healing retries, 404 model recovery, and timeouts.
 * Key transport uses x-goog-api-key header; never logged or passed in query strings.
 * @param {string} apiKey 
 * @param {string} prompt 
 * @returns {Promise<string>}
 */
export async function callGemini(apiKey, prompt) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Your Gemini API key is invalid or unauthorized.');
  }

  const cleanKey = apiKey.trim();
  const requestBody = JSON.stringify({
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      maxOutputTokens: 900,
      temperature: 0.2
    }
  });

  // Resolve model from local cache (or Models API if missing/expired)
  let activeModel;
  try {
    activeModel = await resolveBestGeminiModel(cleanKey);
  } catch (resolveErr) {
    throw normalizeGeminiError(resolveErr);
  }

  // Attempt generation with strictly bounded recovery
  try {
    return await executeGenerateRequest(cleanKey, activeModel, requestBody);
  } catch (firstErr) {
    // 1. If 404: model deprecated or unavailable -> invalidate cache, re-resolve once, retry once
    if (firstErr.status === 404) {
      console.warn(`[Xplainify][Model] Model "${activeModel}" returned 404. Re-resolving models and retrying once...`);
      await invalidateCachedModel();
      try {
        activeModel = await resolveBestGeminiModel(cleanKey, true);
        return await executeGenerateRequest(cleanKey, activeModel, requestBody);
      } catch (retryErr) {
        throw normalizeGeminiError(retryErr);
      }
    }

    // 2. If 5xx: temporary server outage -> wait 1000ms and retry once
    if (firstErr.status >= 500 && firstErr.status < 600) {
      console.warn(`[Xplainify][API] Server returned HTTP ${firstErr.status}. Retrying after 1000ms...`);
      await delay(1000);
      try {
        return await executeGenerateRequest(cleanKey, activeModel, requestBody);
      } catch (retryErr) {
        throw normalizeGeminiError(retryErr);
      }
    }

    // 3. If transient network error (not timeout): wait 500ms and retry once
    if (firstErr.isNetwork && !firstErr.isTimeout) {
      console.warn('[Xplainify][API] Transient network error encountered. Retrying after 500ms...');
      await delay(500);
      try {
        return await executeGenerateRequest(cleanKey, activeModel, requestBody);
      } catch (retryErr) {
        throw normalizeGeminiError(retryErr);
      }
    }

    // Otherwise throw normalized error (no retry for 401/403, 429, timeout, safety)
    throw normalizeGeminiError(firstErr);
  }
}

/**
 * Sends the POST request to generateContent with AbortController timeout and header key transport.
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
    const err = new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    err.status = response.status;
    err.apiDetail = detail;
    if (detail.toLowerCase().includes('api key') || detail.toLowerCase().includes('key not valid')) {
      err.isAuth = true;
    }
    throw err;
  }

  const data = await response.json();

  // Validate nested response structure thoroughly
  if (
    !data ||
    !data.candidates ||
    !Array.isArray(data.candidates) ||
    data.candidates.length === 0 ||
    !data.candidates[0].content ||
    !data.candidates[0].content.parts ||
    !Array.isArray(data.candidates[0].content.parts) ||
    data.candidates[0].content.parts.length === 0 ||
    typeof data.candidates[0].content.parts[0].text !== 'string'
  ) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      const err = new Error('Safety block');
      err.isSafety = true;
      throw err;
    }
    const err = new Error('Empty or unexpected response structure from Gemini.');
    err.isEmpty = true;
    throw err;
  }

  const resultText = data.candidates[0].content.parts[0].text.trim();
  if (resultText.length === 0) {
    const err = new Error('Empty response text');
    err.isEmpty = true;
    throw err;
  }

  return resultText;
}

/**
 * Normalizes any error into clean, user-friendly copy without leaking keys or raw stack traces.
 * @param {Error} err 
 * @returns {Error}
 */
export function normalizeGeminiError(err) {
  if (err.isTimeout) {
    return new Error('The request took too long. Please try again.');
  }

  if (err.isNetwork) {
    return new Error('Unable to reach Gemini. Check your internet connection and try again.');
  }

  const msg = (err.message || '').toLowerCase();
  const detail = (err.apiDetail || '').toLowerCase();

  if (
    err.isAuth || 
    err.status === 401 || 
    err.status === 403 || 
    msg.includes('401') || 
    msg.includes('403') || 
    msg.includes('api key') || 
    detail.includes('api key') ||
    detail.includes('key not valid') ||
    msg.includes('unauthorized')
  ) {
    const authErr = new Error('Your Gemini API key is invalid or unauthorized.');
    authErr.status = 401;
    authErr.isAuth = true;
    return authErr;
  }

  if (err.status === 404) {
    return new Error('The requested AI model is currently unavailable. Please try again.');
  }

  if (err.status === 429) {
    return new Error('Gemini is temporarily rate-limiting requests. Please try again shortly.');
  }

  if (err.status >= 500) {
    return new Error('Gemini is temporarily unavailable. Please try again shortly.');
  }

  if (err.isSafety) {
    return new Error('Content could not be processed due to safety restrictions.');
  }

  if (err.isEmpty) {
    return new Error('Received an empty response from Gemini. Please try again.');
  }

  console.error('[Xplainify][API] Request notice:', err.message || err);
  return new Error('Something went wrong while processing this page. Please try again.');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

