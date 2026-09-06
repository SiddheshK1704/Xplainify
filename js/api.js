export async function callGemini(apiKey, prompt) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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
      throw new Error('Invalid or expired API key. Please check your key in Settings.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status}). Please try again.`);
    }

    const data = await response.json();
    
    if (!data || !data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
      throw new Error('Received an empty response from Gemini. Please try again.');
    }

    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    if (error.name === 'TypeError' || error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      throw new Error('Network error. Please check your connection and try again.');
    }
    throw error;
  }
}
