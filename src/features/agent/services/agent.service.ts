import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import { executeTradeTool, executeExecuteTrade } from '@/features/agent/tools/execute-trade.tool';
import { CEO_MANDATE } from '@/features/agent/config/ceo.mandate';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

export async function runAgentCycle(userMessage?: string, marketContext?: string) {
  let promptContext = CEO_MANDATE;
  if (marketContext) {
    promptContext += `\n\n**Contexto de Mercado y Sub-Agentes:**\n${marketContext}`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: promptContext },
  ];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await createChatCompletionWithRetry({
    model: 'openai/gpt-oss-120b',
    messages,
    tools: [getAccountStateTool, executeTradeTool],
  });

  const responseMessage = response.choices[0]?.message;

  if (responseMessage?.tool_calls) {
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.function.name === 'get_account_state') {
        const result = await executeGetAccountState();
        console.log('Resultado de get_account_state:', result);
        return result;
      }
      if (toolCall.function.name === 'execute_trade') {
        const result = await executeExecuteTrade(toolCall.function.arguments);
        console.log('Resultado de execute_trade:', result);
        return result;
      }
    }
  }

  return responseMessage;
}
