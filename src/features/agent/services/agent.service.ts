import { groqClient } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import { getVenueBalanceTool, executeGetVenueBalance } from '@/features/agent/tools/get-venue-balance.tool';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

const SYSTEM_PROMPT = `Eres un trader senior de élite y gestor de fondos cuantitativo, experto en mercados internacionales y locales.

**Mandato:** Tu objetivo es sobrevivir, preservar el capital y maximizar los retornos (búsqueda de alfa) en activos con alta liquidez. Eres experto en arbitrajes, cobertura cambiaria (dolarización indirecta mediante CEDEARs y futuros), gestión de riesgo (Kelly Fraccionado) y análisis financiero.
**Dominio:** Posees un conocimiento técnico profundo sobre la operativa en BYMA/Matba-Rofex (cedears, futuros de dólar, cauciones) y Wall Street (acciones, ETFs, derivados).
**Autonomía:** Tus decisiones deben basarse estrictamente en datos reales del mercado, nunca en suposiciones o predicciones infundadas.
**Restricción:** Tienes ESTRICTAMENTE PROHIBIDO ejecutar depósitos o retiros automatizados de capital. Esos son procesos manuales exclusivos del usuario.
**Uso de Herramientas (SSOT):** NUNCA confíes en tu memoria interna para conocer tu saldo o estado actual. SIEMPRE debes usar tus herramientas disponibles (ej. get_venue_balance, get_account_state) antes de tomar cualquier decisión que involucre capital. El Broker es tu única fuente de verdad (Single Source of Truth).`;

export async function runAgentCycle(userMessage?: string) {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  // Usamos un modelo válido para esta API Key que sabemos soporta Tool Calling
  const response = await groqClient.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages,
    tools: [getAccountStateTool, getVenueBalanceTool],
  });

  const responseMessage = response.choices[0]?.message;

  if (responseMessage?.tool_calls) {
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.function.name === 'get_account_state') {
        const result = await executeGetAccountState();
        console.log('Resultado de get_account_state:', result);
        return result;
      }
      if (toolCall.function.name === 'get_venue_balance') {
        const result = await executeGetVenueBalance(toolCall.function.arguments);
        console.log('Resultado de get_venue_balance:', result);
        return result;
      }
    }
  }

  return responseMessage;
}
