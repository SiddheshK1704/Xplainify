/**
 * Xplainify — Gemini API Client
 * Direct browser-to-Gemini API communication using user's local key.
 * Never logs API keys or sends them to any third-party server.
 */

export async function callGemini(apiKey, prompt) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Your Gemini API key is invalid or unavailable. Check Settings.');
  }

  const cleanKey = apiKey.trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(cleanKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Your Gemini API key is invalid or unavailable. Check Settings.');
    }
    if (response.status === 404) {
      throw new Error('The selected Gemini model is unavailable. Please try again later.');
    }
    if (response.status === 429) {
      throw new Error('Gemini is temporarily rate-limited. Please try again in a moment.');
    }
    if (response.status >= 500) {
      throw new Error('Gemini is temporarily unavailable. Please try again.');
    }
    if (!response.ok) {
      throw new Error(`Gemini service error (${response.status}). Please try again.`);
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
        throw new Error('Content could not be processed due to safety restrictions.');
      }
      throw new Error('Received an empty response from Gemini. Please try again.');
    }

    const resultText = data.candidates[0].content.parts[0].text.trim();
    if (resultText.length === 0) {
      throw new Error('Received an empty response from Gemini. Please try again.');
    }

    return resultText;
  } catch (error) {
    if (
      error.name === 'TypeError' || 
      error.message.includes('NetworkError') || 
      error.message.includes('Failed to fetch')
    ) {
      throw new Error('Unable to reach Gemini. Check your connection and try again.');
    }
    
    // Log technical message to developer console without exposing key
    console.error('Gemini request failed:', error.message);
    throw error;
  }
}
