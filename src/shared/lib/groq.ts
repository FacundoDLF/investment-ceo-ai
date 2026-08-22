import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'groq-sdk/resources/chat/completions';

import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';

export const nativeGroqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: 45000,
  maxRetries: 0
});
export const groqClient = nativeGroqClient;

export const openRouterClient = new Groq({
  apiKey: process.env.OPENROUTER_API_KEY || 'dummy_key',
  baseURL: 'https://openrouter.ai/api/v1',
  timeout: 45000,
  maxRetries: 0,
  fetch: async (url, init) => {
    if (typeof url === 'string') {
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
        break;
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
        console.error(`\${ANSI_COLORS.RED}[API Groq] Fallo irreversible: todos los modelos fallaron permanentemente.\${ANSI_COLORS.RESET}`);
        throw new Error("Todos los modelos fallaron permanentemente (400, 403, 404, 5xx)");
      }

      attempt++;
      console.warn(`[LLM API] Todos los modelos en Cooldown. Esperando ${minWaitTime}ms hasta que se libere ${nextModelToFree}...`);
      await new Promise((resolve) => setTimeout(resolve, minWaitTime));
      continue;
    }

    const currentModel = allModels[availableModelIndex];
    const client = currentModel.includes('/') ? openRouterClient : nativeGroqClient;

    if (currentModel !== params.model) {
      const isFree = currentModel.endsWith(':free');
      const warningType = isFree ? 'Free Version' : 'Modelo Suplente';
      console.warn(`\${ANSI_COLORS.YELLOW}[Sistema] ⚠️ ATENCIÓN: Usando ${warningType} (${currentModel}) por fallo del principal.\${ANSI_COLORS.RESET}`);
    }

    try {
      const currentParams = { max_tokens: 500, ...params, model: currentModel };
      delete (currentParams as any).fallbackModels;
      return await client.chat.completions.create(currentParams as ChatCompletionCreateParamsNonStreaming);
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.status === 413;
      const isNetworkError = !error?.status || error?.status >= 500 || error?.name === 'APITimeoutError';

      if (error?.status === 402) {
        if (!currentModel.endsWith(':free')) {
          console.warn(`\${ANSI_COLORS.RED}[API] Error 402 Payment Required en ${currentModel}. Cambiando a modelos gratuitos...\${ANSI_COLORS.RESET}`);
          // Marcar todos los modelos de pago como fallidos para no perder tiempo
          for (const m of allModels) {
            if (!m.endsWith(':free')) permanentlyFailedModels.add(m);
          }
          continue;
        } else {
          console.error(`\${ANSI_COLORS.RED}[API] Error 402 Payment Required en modelo gratuito ${currentModel}. Tu cuenta de OpenRouter está totalmente bloqueada. Abortando.\${ANSI_COLORS.RESET}`);
          throw new Error(`API Key bloqueada (402 Payment Required) al intentar usar modelo gratuito ${currentModel}.`);
        }
      }

      const isModelError = error?.status === 404 || error?.status === 403 || error?.status === 400;

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
            if (parsed > 1577836800000) {
              const wait = parsed - Date.now();
              waitTimeMs = wait > 0 ? wait : 1000;
            } else if (parsed > 1577836800) {
              const wait = (parsed * 1000) - Date.now();
              waitTimeMs = wait > 0 ? wait : 1000;
            } else {
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

        if (waitTimeMs <= 0) waitTimeMs = 15000;

        globalModelCooldowns.set(currentModel, Date.now() + waitTimeMs);
        console.warn(`\${ANSI_COLORS.RED}[Model Fallback]\${ANSI_COLORS.RESET} RateLimit (429) en ${currentModel}. Cooldown: ${waitTimeMs}ms...`);
        continue;
      }

      if (isNetworkError || isModelError) {
        let errorType = isNetworkError ? `Network/Timeout (${error?.status || '5xx'})` : `ModelNotFound/Unsupported (${error?.status})`;
        console.warn(`\${ANSI_COLORS.RED}[Model Fallback]\${ANSI_COLORS.RESET} ${errorType} en ${currentModel}. Descartado para esta solicitud...`);

        // Log al postmortem
        try {
          const fs = require('fs');
          fs.writeFileSync('error_postmortem.json', JSON.stringify({
            timestamp: new Date().toISOString(),
            model: currentModel,
            status: error?.status,
            error: error?.message,
            headers: error?.headers
          }, null, 2));
        } catch (e) { }

        permanentlyFailedModels.add(currentModel);
        continue;
      }

      throw error;
    }
  }
}

