/**
 * Xplainify — Gemini API Client
 * Centralized Gemini model configuration and resilient client.
 * Uses Google's official stable alias: gemini-flash-latest
 * Includes fallback capability and strict key hygiene.
 */

// Single source of truth for Gemini model configuration
export const GEMINI_CONFIG = {
  primaryModel: 'gemini-flash-latest',
  fallbackModel: 'gemini-1.5-flash-latest',
  apiVersion: 'v1beta'
};

/**
 * Calls Gemini generateContent endpoint.
 * @param {string} apiKey 
 * @param {string} prompt 
 * @returns {Promise<string>}
 */
export async function callGemini(apiKey, prompt) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Your Gemini API key is invalid or unavailable. Check Settings.');
  }

  const cleanKey = apiKey.trim();
  const requestBody = JSON.stringify({
    contents: [{
      parts: [{
        text: prompt
      }]
    }]
  });

  // Try primary model first (gemini-flash-latest)
  try {
    return await executeGenerateContent(cleanKey, GEMINI_CONFIG.primaryModel, requestBody);
  } catch (primaryErr) {
    // If 404 on the primary alias, attempt fallback to fallbackModel
    if (primaryErr.status === 404 && GEMINI_CONFIG.fallbackModel) {
      console.warn(`Primary model "${GEMINI_CONFIG.primaryModel}" returned 404. Attempting fallback to "${GEMINI_CONFIG.fallbackModel}"...`);
      try {
        return await executeGenerateContent(cleanKey, GEMINI_CONFIG.fallbackModel, requestBody);
      } catch (fallbackErr) {
        throw mapGeminiError(fallbackErr);
      }
    }
    throw mapGeminiError(primaryErr);
  }
}

/**
 * Executes the HTTP request to Gemini generateContent.
 */
async function executeGenerateContent(apiKey, modelName, body) {
  const endpoint = `https://generativelanguage.googleapis.com/${GEMINI_CONFIG.apiVersion}/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body
    });
  } catch (netErr) {
    const err = new Error('Network error');
    err.isNetwork = true;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();

  if (
    !data ||
    !data.candidates ||
    !data.candidates[0] ||
    !data.candidates[0].content ||
    !data.candidates[0].content.parts ||
    !data.candidates[0].content.parts[0] ||
    typeof data.candidates[0].content.parts[0].text !== 'string'
  ) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      const err = new Error('Safety block');
      err.isSafety = true;
      throw err;
    }
    const err = new Error('Empty response');
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
 * Maps errors to clean, user-facing error messages without exposing keys.
 */
function mapGeminiError(err) {
  if (
    err.isNetwork || 
    err.name === 'TypeError' || 
    (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')))
  ) {
    return new Error('Unable to reach Gemini. Check your connection and try again.');
  }

  if (err.status === 401 || err.status === 403) {
    return new Error('Your Gemini API key is invalid or unavailable. Check Settings.');
  }

  if (err.status === 404) {
    return new Error('The Gemini service is currently unavailable. Please try again.');
  }

  if (err.status === 429) {
    return new Error('Gemini is temporarily rate-limited. Please try again shortly.');
  }

  if (err.status >= 500) {
    return new Error('Gemini is temporarily unavailable. Please try again.');
  }

  if (err.isSafety) {
    return new Error('Content could not be processed due to safety restrictions.');
  }

  // Log non-sensitive technical error to developer console
  console.error('Gemini error:', err.message || err);
  return new Error('Something went wrong while processing this page. Please try again.');
}
