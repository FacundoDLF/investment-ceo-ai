import { DateTime } from 'luxon';
import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { getAccountStateTool, executeGetAccountState } from '@/features/agent/skills/getAccountState';
import { executeTradeTool, executeExecuteTrade } from '@/features/agent/tools/execute-trade.tool';
import { switchAssetTool, executeSwitchAsset } from '@/features/agent/tools/switch-asset.tool';
import { consultAnalystTool, executeConsultAnalyst } from '@/features/agent/tools/consult-analyst.tool';
import { validateTradeIntentTool, executeValidateTradeIntent } from '@/features/agent/tools/validate-trade-intent.tool';
import { closePositionTool, executeClosePosition } from '@/features/agent/tools/close-position.tool';
import { commandScrappyTool, executeCommandScrappy } from '@/features/agent/tools/command-scrappy.tool';
import { registerWithdrawalTool, executeRegisterWithdrawal } from '@/features/agent/tools/register-withdrawal.tool';
import { CEO_MANDATE } from '@/features/agent/config/ceo.mandate';
import { getFriendlyToolName } from '@/shared/utils/tool-names';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

export async function runAgentCycle(userMessage?: string, marketContext?: string) {
  let promptContext = CEO_MANDATE;
  if (marketContext) {
    promptContext += `\n\n**Contexto de Mercado y Sub-Agentes:**\n${marketContext}`;
  }

  promptContext += `\n\nPIENSA EN VOZ ALTA (Chain of Thought): Antes de usar una herramienta, usa libremente tu respuesta (el campo content) para razonar exhaustivamente. Piensa paso a paso. REGLA OBLIGATORIA: Al FINALIZAR tu razonamiento, DEBES resumir tu pensamiento agregando un título de máximo 6 palabras entre corchetes al final de tu texto. IMPORTANTE: Si estás en MODO PORTFOLIO_AUDIT o DAMAGE_CONTROL y decides NO ejecutar ninguna acción (es decir, todo está bien o decides esperar), tu título DEBE indicar el estado de salud claramente, por ejemplo [TÍTULO: Salud OK - Hold] o [TÍTULO: Auditoría Limpia].`;

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
        role: 'CEO',
        messages: currentMessages,
        tools: [getAccountStateTool, validateTradeIntentTool, executeTradeTool, switchAssetTool, consultAnalystTool, closePositionTool, commandScrappyTool, registerWithdrawalTool],
      });
    } catch (error: any) {
      if ((error.status === 400 && error.message?.includes('tool call validation failed')) || 
          error.message?.includes('tool_use_failed') ||
          error.message?.includes('tool call')) {
        console.warn(`${LOG_PREFIX.SISTEMA} ${ANSI_COLORS.RED}Advertencia: El LLM alucinó la herramienta o violó el formato JSON. Reintentando...${ANSI_COLORS.RESET}`);
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
              } catch (e3) { }
            }
          }
        }
      }
    }

    if (responseMessage?.content) {
      const contentStr = responseMessage.content.trim();
      const titleMatch = contentStr.match(/\[T[IÍ]TULO:([^\]]+)\]/i);
      const displayContent = titleMatch ? titleMatch[1].trim() + '...' : 'Procesando estrategia...';
      console.log(`\n${LOG_PREFIX.CEO_TRADER} Razonando:${ANSI_COLORS.RESET} ${displayContent} \x1b[90m(pensamiento oculto)${ANSI_COLORS.RESET}`);
    }

    currentMessages.push(responseMessage as ChatCompletionMessageParam);

    if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        let result: any;
        console.log(`${LOG_PREFIX.CEO_TRADER} ${getFriendlyToolName(toolCall.function.name)}${ANSI_COLORS.RESET}`);

        try {
          const args = JSON.parse(toolCall.function.arguments);
          if (Object.keys(args).length > 0) {
            const keyTranslations: Record<string, string> = {
              duda: 'Consulta',
              venue: 'Broker',
              symbol: 'Coin',
              side: 'Acción',
              qty: 'Cantidad',
              category: 'Categoría',
              type: 'Tipo',
              limitPrice: 'Precio Limite',
              stopLoss: 'Stop Loss',
              takeProfit: 'Target',
              strategy: 'Estrategia',
              thesis: 'Tesis'
            };
            const formattedArgs = Object.entries(args)
              .map(([k, v]) => {
                const valStr = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
                return `${LOG_PREFIX.CEO_TRADER} ${ANSI_COLORS.WHITE}${keyTranslations[k] || k}:${ANSI_COLORS.RESET} ${valStr}`;
              })
              .join('\n');
            console.log(formattedArgs);
          }
        } catch (e) {
          console.log(`${ANSI_COLORS.WHITE}Argumentos: ${toolCall.function.arguments}${ANSI_COLORS.RESET}`);
        }

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
        } else if (toolCall.function.name === 'close_position') {
          result = await executeClosePosition(toolCall.function.arguments);
        } else if (toolCall.function.name === 'command_scrappy') {
          result = await executeCommandScrappy(toolCall.function.arguments);
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
            displayResult = `\n` +
              `${ANSI_COLORS.GRAY}  ├─ Bybit  : Cash ${ANSI_COLORS.GREEN}$${bybitCash}${ANSI_COLORS.GRAY} (Spot: ${ANSI_COLORS.GREEN}$${bybitSpot}${ANSI_COLORS.GRAY} | Futuros: ${ANSI_COLORS.GREEN}$${bybitPower}${ANSI_COLORS.GRAY})${ANSI_COLORS.RESET}\n` +
              `${ANSI_COLORS.GRAY}  ├─ Alpaca : Cash ${ANSI_COLORS.GREEN}$${alpacaCash}${ANSI_COLORS.RESET}\n` +
              `${ANSI_COLORS.GRAY}  └─ Posiciones Totales: ${ANSI_COLORS.YELLOW}${positions}${ANSI_COLORS.RESET}`;
          } else if (toolCall.function.name === 'execute_trade') {
            if (parsed?.error) {
              displayResult = `❌ Error: ${parsed.error}`;
            } else {
              displayResult = `✅ Orden creada con éxito (ID: ${parsed?.orderId})`;
            }
          } else if (toolCall.function.name === 'validate_trade_intent') {
            if (parsed?.status === 'APPROVED_TECHNICAL') {
              displayResult = `${ANSI_COLORS.GREEN}Aprobado${ANSI_COLORS.RESET}`;
            } else {
              displayResult = `❌ Rechazado: ${parsed?.reason || parsed?.error || 'Motivo desconocido'}`;
            }
          } else if (toolCall.function.name === 'get_market_price') {
            if (parsed?.success) {
              displayResult = `Activo: ${parsed.symbol} | Precio exacto: (Ask: $${parsed.ask}, Bid: $${parsed.bid})`;
            } else {
              displayResult = `Error: ${parsed?.error}`;
            }
          } else if (toolCall.function.name === 'consult_smart_analyst') {
            displayResult = `Informe Estratégico completado y entregado al CEO.`;
          } else if (toolCall.function.name === 'command_scrappy') {
            if (parsed?.success) {
              displayResult = `✅ ${parsed.message}`;
            } else {
              displayResult = `❌ Error: ${parsed?.error || 'Error de configuración'}`;
            }
          } else if (toolCall.function.name === 'close_position') {
            if (parsed?.error) {
              displayResult = `❌ Error: ${parsed.error}`;
            } else {
              displayResult = `✅ ${parsed?.message || 'Posición cerrada'} (Motivo: ${parsed?.reason})`;
            }
          } else if (typeof result === 'object') {
            displayResult = JSON.stringify(result);
          }
        } catch (e) {
          if (typeof result === 'object') displayResult = JSON.stringify(result);
        }

        let finalColor = ANSI_COLORS.WHITE;
        if (typeof displayResult === 'string') {
          if (displayResult.includes('❌') || displayResult.includes('Rechazado') || displayResult.includes('Error')) {
            finalColor = ANSI_COLORS.RED;
          } else if (displayResult.includes('✅') || displayResult.includes('Aprobado') || displayResult.includes('completado')) {
            finalColor = ANSI_COLORS.GREEN;
          }
        }

        if (toolCall.function.name === 'consult_smart_analyst') {
          console.log(`${LOG_PREFIX.SISTEMA} ${finalColor}${displayResult}${ANSI_COLORS.RESET}`);
        } else {
          let resultTitle = `Resultado de ${getFriendlyToolName(toolCall.function.name)}`;
          if (toolCall.function.name === 'validate_trade_intent') {
            resultTitle = `Resultados de Validación`;
          }
          console.log(`${LOG_PREFIX.SISTEMA} ${resultTitle}: ${finalColor}${displayResult}${ANSI_COLORS.RESET}`);
        }

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
