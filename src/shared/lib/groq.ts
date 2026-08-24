import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletion } from 'groq-sdk/resources/chat/completions';

import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import { ModelRouter, ModelRole, AIModel } from '@/shared/constants/models';

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

export interface ExtendedChatCompletionParams extends Omit<ChatCompletionCreateParamsNonStreaming, 'model'> {
  model?: string;
  role?: ModelRole;
}

export async function createChatCompletionWithRetry(
  params: ExtendedChatCompletionParams,
  maxRetries = 100
): Promise<ChatCompletion> {
  let attempt = 0;

  while (true) {
    // Obtener el mejor modelo disponible según el rol (ya filtrado por salud)
    const available = params.role ? ModelRouter.getAvailableForRole(params.role) : [];

    if (available.length === 0 && !params.model) {
      // Blackout total: todos los modelos agotados. En lugar de crashear,
      // esperamos 2 minutos y reseteamos la salud para reintentar.
      console.error(`${ANSI_COLORS.RED}[API] ⚠️  Blackout total: sin modelos disponibles para el rol "${params.role}". Esperando 120s para reintentar...${ANSI_COLORS.RESET}`);
      await new Promise(resolve => setTimeout(resolve, 120_000));
      ModelRouter.resetAllHealth();
      console.warn(`${ANSI_COLORS.YELLOW}[API] 🔄 Salud de modelos reseteada. Reintentando...${ANSI_COLORS.RESET}`);
      attempt = 0;
      continue;
    }

    // Si se pasa model directo (override puntual), usarlo. Si no, tomar el primero disponible del rol.
    const currentModel = params.model
      ? { uid: params.model, id: params.model, provider: (params.model.includes('/') ? 'openrouter' : 'groq') as 'groq' | 'openrouter', tier: 'free' as const }
      : available[0];

    const client = currentModel.provider === 'openrouter' ? openRouterClient : nativeGroqClient;

    // Registrar el modelo activo (notifica en consola sólo si cambió)
    if (params.role) {
      ModelRouter.trackActiveModel(params.role, currentModel as AIModel);
    }

    if (attempt > 0) {
      const providerLabel = currentModel.provider === 'groq' ? 'Groq' : 'OpenRouter';
      const tierLabel = currentModel.tier === 'free' ? 'Free' : 'Paid';
      console.warn(`${ANSI_COLORS.YELLOW}[Sistema] ⚠️ Fallback activado: usando ${currentModel.id} (${providerLabel} / ${tierLabel})${ANSI_COLORS.RESET}`);
    }

    try {
      const currentParams = { max_tokens: 500, ...params, model: currentModel.id };
      delete (currentParams as any).role;
      return await client.chat.completions.create(currentParams as ChatCompletionCreateParamsNonStreaming);
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.status === 413;
      const isNetworkError = !error?.status || error?.status >= 500 || error?.name === 'APITimeoutError';
      const errorString = JSON.stringify(error || {});
      const isToolUseFailed = error?.status === 400 && (
        error?.error?.code === 'tool_use_failed' || 
        error?.message?.includes('tool call') ||
        errorString.includes('tool_use_failed') ||
        errorString.includes('Tool choice is required')
      );
      const isModelError = error?.status === 404 || error?.status === 403 || (error?.status === 400 && !isToolUseFailed);

      if (isToolUseFailed) {
        // Groq API throws 400 when the LLM generates invalid JSON for a tool call.
        // This is a generation error, not an endpoint failure. We should not deprecate the model.
        throw new Error(`LLM Generation Error (400 tool_use_failed): ${error?.message}`);
      }

      if (error?.status === 402) {
        if (currentModel.tier === 'paid') {
          console.warn(`${ANSI_COLORS.RED}[API] Error 402 Payment Required en ${currentModel.id} (${currentModel.provider}). Detalles: ${error?.message || 'Sin fondos'}. Desactivando todos los modelos de pago...${ANSI_COLORS.RESET}`);
          ModelRouter.markAllPaidAsFailed('402 Payment Required');
          attempt++;
          continue;
        } else {
          console.error(`${ANSI_COLORS.RED}[API] Error 402 en modelo free ${currentModel.id}. Detalles: ${error?.message || 'Cuenta bloqueada'}. Abortando.${ANSI_COLORS.RESET}`);
          throw new Error(`API Key bloqueada (402) en modelo gratuito ${currentModel.id}.`);
        }
      }

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
              waitTimeMs = Math.max(parsed - Date.now(), 1000);
            } else if (parsed > 1577836800) {
              waitTimeMs = Math.max((parsed * 1000) - Date.now(), 1000);
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

        // Marcar por UID para no contaminar el mismo modelo en otro proveedor
        ModelRouter.markAsRateLimited(currentModel.uid, waitTimeMs);
        console.warn(`${ANSI_COLORS.RED}[Model Fallback]${ANSI_COLORS.RESET} RateLimit (429) en ${currentModel.id} [${currentModel.provider}]. Cooldown: ${Math.round(waitTimeMs / 1000)}s. Detalles: ${error?.message || ''}`);
        attempt++;
        continue;
      }

      if (isNetworkError || isModelError) {
        const errorType = isNetworkError
          ? `Network/Timeout (${error?.status || '5xx'})`
          : `ModelNotFound/Unsupported (${error?.status})`;
        console.warn(`${ANSI_COLORS.RED}[Model Fallback]${ANSI_COLORS.RESET} ${errorType} en ${currentModel.id} [${currentModel.provider}]. Detalles: ${error?.message || ''}. Descartado.`);

        // Postmortem
        try {
          const fs = require('fs');
          fs.writeFileSync('error_postmortem.json', JSON.stringify({
            timestamp: new Date().toISOString(),
            uid: currentModel.uid,
            model: currentModel.id,
            provider: currentModel.provider,
            status: error?.status,
            error: error?.message
          }, null, 2));
        } catch (_) { }

        // Marcar por UID — solo este proveedor queda penalizado
        ModelRouter.markAsFailed(currentModel.uid, error?.message);
        attempt++;
        continue;
      }

      throw error;
    }
  }
}
