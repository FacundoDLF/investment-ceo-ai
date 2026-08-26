import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';

export const getCryptoSentimentTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_crypto_sentiment',
    description: 'Fetches the current Crypto Fear & Greed Index from alternative.me API. Returns a score from 0 (Extreme Fear) to 100 (Extreme Greed) and the classification.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export async function executeGetCryptoSentiment(): Promise<any> {
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    if (data && data.data && data.data.length > 0) {
      const current = data.data[0];
      return {
        success: true,
        score: parseInt(current.value, 10),
        classification: current.value_classification,
        timestamp: new Date(parseInt(current.timestamp) * 1000).toISOString(),
      };
    }
    
    throw new Error('No data found in Alternative.me API response');
  } catch (error: any) {
    console.error(`[Tool] Error obteniendo sentimiento cripto: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
