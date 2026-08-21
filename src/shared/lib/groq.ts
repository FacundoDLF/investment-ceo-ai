import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'groq-sdk/resources/chat/completions';

const isOpenRouter = !!process.env.OPENROUTER_API_KEY;

export const groqClient = new Groq({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY,
  baseURL: isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined,
  timeout: 45000,
  maxRetries: 0,
  fetch: async (url, init) => {
    if (isOpenRouter && typeof url === 'string') {
      // El SDK de Groq inyecta "/openai/v1" a la fuerza. Lo removemos para que funcione con OpenRouter.
      url = url.replace('/openai/v1/chat/completions', '/chat/completions');
    }
    return fetch(url, init);
  }
});

export interface ExtendedChatCompletionParams extends ChatCompletionCreateParamsNonStreaming {
  fallbackModels?: string[];
}

const globalModelCooldowns = new Map<string, number>();

export async function createChatCompletionWithRetry(
  params: ExtendedChatCompletionParams,
  maxRetries = 100
): Promise<ChatCompletion> {
  let attempt = 0;
  const allModelsRaw = [params.model, ...(params.fallbackModels || [])];
  const allModels: string[] = [...allModelsRaw];
  const permanentlyFailedModels = new Set<string>();

  while (true) {
    const now = Date.now();
    let availableModelIndex = -1;
    let minWaitTime = Infinity;
    let nextModelToFree = '';

    for (let i = 0; i < allModels.length; i++) {
      const model = allModels[i];
      if (permanentlyFailedModels.has(model)) continue;

      const cooldown = globalModelCooldowns.get(model) || 0;
      if (cooldown <= now) {
        availableModelIndex = i;
        break; // Encontramos el primero disponible!
      } else {
        const waitTime = cooldown - now;
        if (waitTime < minWaitTime) {
          minWaitTime = waitTime;
          nextModelToFree = model;
        }
      }
    }

    if (availableModelIndex === -1) {
      if (minWaitTime === Infinity) {
        console.error(`\x1b[31m[API Groq] Fallo irreversible: todos los modelos fallaron permanentemente.\x1b[0m`);
        throw new Error("Todos los modelos fallaron permanentemente (400, 403, 404, 5xx)");
      }

      attempt++;
      console.warn(`[LLM API] Todos los modelos en Cooldown. Esperando ${minWaitTime}ms hasta que se libere ${nextModelToFree} (Reintento basado en Header)...`);
      await new Promise((resolve) => setTimeout(resolve, minWaitTime));
      continue; // Volvemos a evaluar el loop, el modelo ya debería estar libre
    }

    const currentModel = allModels[availableModelIndex];
    try {
      const currentParams = { max_tokens: 500, ...params, model: currentModel };
      delete (currentParams as any).fallbackModels;
      return await groqClient.chat.completions.create(currentParams as ChatCompletionCreateParamsNonStreaming);
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.status === 413;
      const isNetworkError = !error?.status || error?.status >= 500 || error?.name === 'APITimeoutError';
      const isModelError = error?.status === 404 || error?.status === 403 || error?.status === 400 || error?.status === 402;

      if (isRateLimit) {
        let waitTimeMs = 0;
        const getHeader = (name: string) => {
          let val = typeof error?.headers?.get === 'function' ? error.headers.get(name) : error?.headers?.[name];
          if (!val) {
             val = error?.error?.metadata?.headers?.[name] || error?.error?.metadata?.headers?.[name.replace(/(^\w|-\w)/g, (c) => c.toUpperCase())];
          }
          return val;
        };
        const retryAfterRaw = getHeader('retry-after') || getHeader('x-ratelimit-reset') || getHeader('x-ratelimit-reset-requests') || getHeader('x-ratelimit-reset-tokens') || getHeader('Retry-After');

        if (retryAfterRaw) {
          const cleaned = retryAfterRaw.toString().replace(/ms/gi, '').replace(/s/gi, '').trim();
          const parsed = Number(cleaned);
          if (!Number.isNaN(parsed) && parsed > 0) {
            if (parsed > 1577836800000) { // UNIX timestamp in milliseconds
              const wait = parsed - Date.now();
              waitTimeMs = wait > 0 ? wait : 1000;
            } else if (parsed > 1577836800) { // UNIX timestamp in seconds
              const wait = (parsed * 1000) - Date.now();
              waitTimeMs = wait > 0 ? wait : 1000;
            } else { // Duration in seconds
              waitTimeMs = parsed * 1000;
            }
          }
        }

        if (waitTimeMs <= 0 && error?.message) {
          const secMatch = error.message.match(/try again in (?:.*?(\d+)m)?.*?(\d+(\.\d+)?)s/i);
          if (secMatch) {
            const mins = secMatch[1] ? Number(secMatch[1]) : 0;
            const secs = secMatch[2] ? Number(secMatch[2]) : 0;
            waitTimeMs = (mins * 60 + secs) * 1000;
          }
        }

        if (waitTimeMs <= 0) {
          // Si es Rate Limit pero no hay header explícito, escribimos un log post-mortem y abortamos.
          const fs = require('fs');
          const path = require('path');
          const logPath = path.join(process.cwd(), 'error_postmortem.json');
          fs.writeFileSync(logPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            error: error?.message,
            status: error?.status,
            headers: error?.headers,
            metadata: error?.error?.metadata || error?.metadata,
            model: currentModel
          }, null, 2));
          throw new Error(`Fallo por RateLimit/Timeout sin tiempo de espera definido. Log post-mortem guardado en: ${logPath}`);
        }

        // Registrar el cooldown a nivel global para este modelo exacto
        globalModelCooldowns.set(currentModel, Date.now() + waitTimeMs);
        console.warn(`\x1b[31m[Model Fallback]\x1b[0m RateLimit (429) en ${currentModel}. Cooldown registrado: ${waitTimeMs}ms...`);
        continue;
      } 
      
      if (isNetworkError || isModelError) {
        let errorType = isNetworkError ? `Network/Timeout (${error?.status || '5xx'})` : `ModelNotFound/Unsupported (${error?.status})`;
        console.warn(`\x1b[31m[Model Fallback]\x1b[0m ${errorType} en ${currentModel}. Descartado para esta solicitud...`);
        permanentlyFailedModels.add(currentModel);
        continue;
      }

      throw error;
    }
  }
}
