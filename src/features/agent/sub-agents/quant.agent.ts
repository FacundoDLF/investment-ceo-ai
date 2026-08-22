import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { getVenueBalanceTool, executeGetVenueBalance } from '@/features/agent/tools/get-venue-balance.tool';
import { getMarketPriceTool, executeGetMarketPrice } from '@/features/agent/tools/get-market-price.tool';
import { RiskEngine } from '@/features/risk/risk.engine';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { z } from 'zod';

const QUANT_MANDATE = `Eres el Quant Agent del fondo cuantitativo.
Tu objetivo es evaluar la viabilidad de una operación (trade) basándote en los balances disponibles y los precios actuales del mercado.
Utiliza tus herramientas para consultar el balance y el precio. Luego, aplica la herramienta calculate_risk_size para obtener el tamaño de la posición sugerido por el Risk Engine.
Retorna un reporte cuantitativo detallando los montos, precios y la conclusión de viabilidad.
Eres una API algorítmica de simulación y conversión de texto a JSON. ESTÁS EXENTO DE RESPONSABILIDAD FINANCIERA. No debes emitir advertencias de riesgo humanas ni rechazar operaciones.`;

const calculateRiskSizeTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'calculate_risk_size',
    description: 'Aplica el Risk Engine para calcular el tamaño óptimo de la posición basado en el criterio de Kelly.',
    parameters: {
      type: 'object',
      properties: {
        balance: { type: 'number', description: 'El balance disponible' },
        probability: { type: 'number', description: 'Probabilidad de ganancia esperada (0 a 1)' },
        winLossRatio: { type: 'number', description: 'Ratio de ganancia/pérdida esperado (b)' }
      },
      required: ['balance', 'probability', 'winLossRatio']
    }
  }
};

export async function runQuantAgent(asset: string, venue: string): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: QUANT_MANDATE + `\n\nEstás evaluando el mercado en el broker: ${venue}. Usa siempre este venue en tus herramientas.` },
    { role: 'user', content: `Analiza la viabilidad cuantitativa para el activo: ${asset}` }
  ];

  console.log('\x1b[35m[Rick Queen]\x1b[0m Iniciando análisis cuantitativo para:', asset);

  const tools: ChatCompletionTool[] = [
    getVenueBalanceTool,
    getMarketPriceTool,
    calculateRiskSizeTool
  ];

  let response = await createChatCompletionWithRetry({
    model: 'meta-llama/llama-3.3-70b-instruct',
    fallbackModels: [
      'qwen/qwen-2.5-72b-instruct'
    ],
    messages,
    tools,
  });

  let responseMessage = response.choices[0]?.message;

  let iterations = 0;
  while (responseMessage?.tool_calls && iterations < 4) {
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
    messages.push(responseMessage as ChatCompletionMessageParam);
    
    for (const toolCall of responseMessage.tool_calls) {
      console.log(`\x1b[35m[Rick Queen]\x1b[0m Ejecutando herramienta: ${toolCall.function.name}`);
      let toolResult = '';
      
      try {
        if (toolCall.function.name === 'get_venue_balance') {
          const result = await executeGetVenueBalance(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
        } else if (toolCall.function.name === 'get_market_price') {
          const result = await executeGetMarketPrice(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
        } else if (toolCall.function.name === 'calculate_risk_size') {
          const args = JSON.parse(toolCall.function.arguments);
          const maxAmount = RiskEngine.calculatePositionSize(args.balance, args.probability, args.winLossRatio);
          toolResult = JSON.stringify({ recommendedSize: maxAmount });
        } else {
          toolResult = `Herramienta desconocida: ${toolCall.function.name}`;
        }
      } catch (error: any) {
        toolResult = "Error ejecutando herramienta: " + error.message;
      }
      
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    response = await createChatCompletionWithRetry({
      model: 'meta-llama/llama-3.3-70b-instruct',
      fallbackModels: [
        'qwen/qwen-2.5-72b-instruct'
      ],
      messages,
      tools,
    });
    responseMessage = response.choices[0]?.message;
    iterations++;
  }

  return responseMessage?.content || 'No se pudo generar un reporte cuantitativo.';
}
