import { groqClient } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import { getVenueBalanceTool, executeGetVenueBalance } from '@/features/agent/tools/get-venue-balance.tool';
import { serperSearchTool, executeSerperSearch } from '@/features/agent/tools/serper-search.tool';
import { tavilyResearchTool, executeTavilyResearch } from '@/features/agent/tools/tavily-research.tool';
import { getMarketPriceTool, executeGetMarketPrice } from '@/features/agent/tools/get-market-price.tool';
import { executeTradeTool, executeExecuteTrade } from '@/features/agent/tools/execute-trade.tool';
import { CEO_MANDATE } from '@/features/agent/config/ceo.mandate';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

export async function runAgentCycle(userMessage?: string, marketContext?: string) {
  let promptContext = CEO_MANDATE;
  if (marketContext) {
    promptContext += `\n\n**Contexto de Mercado Actual:**\n${marketContext}`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: promptContext },
  ];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await groqClient.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages,
    tools: [getAccountStateTool, getVenueBalanceTool, serperSearchTool, tavilyResearchTool, getMarketPriceTool, executeTradeTool],
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
      if (toolCall.function.name === 'serper_search') {
        const result = await executeSerperSearch(toolCall.function.arguments);
        console.log('Resultado de serper_search:', result);
        return result;
      }
      if (toolCall.function.name === 'tavily_research') {
        const result = await executeTavilyResearch(toolCall.function.arguments);
        console.log('Resultado de tavily_research:', result);
        return result;
      }
      if (toolCall.function.name === 'get_market_price') {
        const result = await executeGetMarketPrice(toolCall.function.arguments);
        console.log('Resultado de get_market_price:', result);
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
