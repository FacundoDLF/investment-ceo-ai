import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import { executeTradeTool, executeExecuteTrade } from '@/features/agent/tools/execute-trade.tool';
import { switchAssetTool, executeSwitchAsset } from '@/features/agent/tools/switch-asset.tool';
import { consultAnalystTool, executeConsultAnalyst } from '@/features/agent/tools/consult-analyst.tool';
import { validateTradeIntentTool, executeValidateTradeIntent } from '@/features/agent/tools/validate-trade-intent.tool';
import { CEO_MANDATE } from '@/features/agent/config/ceo.mandate';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

export async function runAgentCycle(userMessage?: string, marketContext?: string) {
  let promptContext = CEO_MANDATE;
  if (marketContext) {
    promptContext += `\n\n**Contexto de Mercado y Sub-Agentes:**\n${marketContext}`;
  }
  
  promptContext += `\n\nREGLA ESTRICTA DE CONSOLA: Al explicar tu razonamiento (en el campo content), DEBES ser extremadamente breve y telegráfico. Usa el formato "Label: Value". MÁXIMO 2 o 3 renglones. NUNCA uses tablas, ni formato largo, ni explicaciones largas. Ejemplo válido:\nEstado: Buscando oportunidad\nRiesgo: Alto\nAcción: Ninguna`;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: promptContext },
  ];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  let currentMessages: ChatCompletionMessageParam[] = [...messages];
  let iterations = 0;
  let finalResult: any = null;

  while (iterations < 5) {
    let response;
    try {
      response = await createChatCompletionWithRetry({
        model: 'meta-llama/llama-3.3-70b-instruct',
        fallbackModels: [
          'qwen/qwen-2.5-72b-instruct'
        ],
        messages: currentMessages,
        tools: [getAccountStateTool, validateTradeIntentTool, executeTradeTool, switchAssetTool, consultAnalystTool],
      });
    } catch (error: any) {
      if (error.status === 400 && error.message?.includes('tool call validation failed')) {
        console.warn('\x1b[31m[Sistema] Advertencia: El LLM alucinó la herramienta o violó el formato JSON. Reintentando...\x1b[0m');
        currentMessages.push({ 
          role: 'user', 
          content: 'Tu última llamada a herramienta fue rechazada por el servidor porque usaste un nombre inválido (ej: agregaste <|channel|>) o violaste el esquema JSON. Responde con el nombre de herramienta y formato exacto requerido.'
        });
        iterations++;
        continue;
      }
      throw error;
    }

    const responseMessage = response.choices[0]?.message;

    if (responseMessage) {
      delete (responseMessage as any).refusal;
      if (responseMessage.tool_calls) {
        for (const tc of responseMessage.tool_calls) {
          try {
            JSON.parse(tc.function.arguments);
          } catch (e) {
            try {
              JSON.parse(tc.function.arguments + '}');
              tc.function.arguments += '}';
            } catch (e2) {
              try {
                JSON.parse(tc.function.arguments + '"}');
                tc.function.arguments += '"}';
              } catch (e3) {}
            }
          }
        }
      }
    }

    if (responseMessage?.content) {
      console.log(`\n\x1b[36m[CEO Trader] Razonamiento:\x1b[0m\n${responseMessage.content}\n`);
    }

    currentMessages.push(responseMessage as ChatCompletionMessageParam);

    if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        let result: any;
        console.log(`\x1b[36m[CEO Trader] Ejecutando acción estratégica: ${toolCall.function.name}\x1b[0m`);
        console.log(`\x1b[37mArgumentos: ${toolCall.function.arguments}\x1b[0m`);
        
        if (toolCall.function.name === 'get_account_state') {
          result = await executeGetAccountState();
        } else if (toolCall.function.name === 'execute_trade') {
          result = await executeExecuteTrade(toolCall.function.arguments);
        } else if (toolCall.function.name === 'validate_trade_intent') {
          result = await executeValidateTradeIntent(toolCall.function.arguments);
        } else if (toolCall.function.name === 'switch_monitored_asset') {
          result = await executeSwitchAsset(toolCall.function.arguments);
        } else if (toolCall.function.name === 'consult_smart_analyst') {
          result = await executeConsultAnalyst(toolCall.function.arguments, marketContext || '');
        }

        let displayResult = result;
        
        try {
          const parsed = typeof result === 'string' && result.startsWith('{') ? JSON.parse(result) : result;
          
          if (toolCall.function.name === 'get_account_state') {
            const bybitCash = parsed?.consolidatedBalance?.bybit?.cash ? parsed.consolidatedBalance.bybit.cash.toFixed(2) : '0';
            const bybitSpot = parsed?.consolidatedBalance?.bybit?.spotPower ? parsed.consolidatedBalance.bybit.spotPower.toFixed(2) : '0';
            const bybitPower = parsed?.consolidatedBalance?.bybit?.dayTradingPower ? parsed.consolidatedBalance.bybit.dayTradingPower.toFixed(2) : '0';
            const alpacaCash = parsed?.consolidatedBalance?.alpaca?.cash ? parsed.consolidatedBalance.alpaca.cash.toFixed(2) : '0';
            const positions = (parsed?.positions?.alpaca?.length || 0) + (parsed?.positions?.bybit?.length || 0);
            displayResult = `Cash Bybit: $${bybitCash} (Poder Spot: $${bybitSpot} | Poder Futuros: $${bybitPower}) | Cash Alpaca: $${alpacaCash} | Posiciones Totales: ${positions}`;
          } else if (toolCall.function.name === 'execute_trade') {
            if (parsed?.error) {
              displayResult = `❌ Error: ${parsed.error}`;
            } else {
              displayResult = `✅ Orden creada con éxito (ID: ${parsed?.orderId})`;
            }
          } else if (typeof result === 'object') {
            displayResult = JSON.stringify(result);
          }
        } catch (e) {
          if (typeof result === 'object') displayResult = JSON.stringify(result);
        }

        console.log(`\x1b[32m[Sistema] Resultado de ${toolCall.function.name}:\x1b[0m ${displayResult}`);
        
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(result)
        } as ChatCompletionMessageParam);
        
        finalResult = result;
      }
      iterations++;
    } else {
      return responseMessage?.content || finalResult;
    }
  }

  return finalResult;
}
