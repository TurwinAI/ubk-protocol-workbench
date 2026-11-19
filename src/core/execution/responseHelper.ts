// Helper to safely extract text from Gemini response
export const extractText = (response: any): string => {
  if (response?.text && typeof response.text === 'function') {
    return response.text();
  }
  if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return response.candidates[0].content.parts[0].text;
  }
  return '';
};
