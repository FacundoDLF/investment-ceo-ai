import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'groq-sdk/resources/chat/completions';

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function createChatCompletionWithRetry(
  params: ChatCompletionCreateParamsNonStreaming,
  maxRetries = 3
): Promise<ChatCompletion> {
  let attempt = 0;
  while (true) {
    try {
      return await groqClient.chat.completions.create(params);
    } catch (error: any) {
      if (error?.status === 429 && attempt < maxRetries) {
        attempt++;
        let waitTimeMs = 0;

        const retryAfterRaw = typeof error?.headers?.get === 'function' 
          ? error.headers.get('retry-after') 
          : error?.headers?.['retry-after'];

        if (retryAfterRaw) {
          const parsed = Number(retryAfterRaw);
          if (!Number.isNaN(parsed) && parsed > 0) {
            waitTimeMs = parsed * 1000;
          }
        }

        if (waitTimeMs <= 0) {
          waitTimeMs = Math.pow(2, attempt) * 1000;
        }

        console.warn(`[Groq API] RateLimitError (429) detectado. Reintentando en ${waitTimeMs}ms (Intento ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
      } else {
        throw error;
      }
    }
  }
}
