import { groqClient } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

const SYSTEM_PROMPT = "Eres el CEO de un fondo de inversión autónomo. Tu objetivo es sobrevivir y maximizar el capital. Solo puedes tomar decisiones basándote en la información real de tu cuenta y los datos del mercado. Siempre debes consultar tu saldo y objetivos antes de operar.";

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
    tools: [getAccountStateTool],
  });

  const responseMessage = response.choices[0]?.message;

  if (responseMessage?.tool_calls) {
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.function.name === 'get_account_state') {
        const result = await executeGetAccountState();
        console.log('Resultado de get_account_state:', result);
        return result;
      }
    }
  }

  return responseMessage;
}
