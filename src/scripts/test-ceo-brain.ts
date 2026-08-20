import { groqClient } from '../shared/lib/groq';
import { getVenueBalanceTool, executeGetVenueBalance } from '../features/agent/tools/get-venue-balance.tool';
import { serperSearchTool, executeSerperSearch } from '../features/agent/tools/serper-search.tool';
import { tavilyResearchTool, executeTavilyResearch } from '../features/agent/tools/tavily-research.tool';
import { getMarketPriceTool, executeGetMarketPrice } from '../features/agent/tools/get-market-price.tool';
import { CEO_MANDATE } from '../features/agent/config/ceo.mandate';
import { logExecution } from '../features/risk/journal.service';
import type { ChatCompletionMessageParam, ChatCompletionToolMessageParam } from 'groq-sdk/resources/chat/completions';

async function runTest() {
  console.log('Iniciando prueba de estrés del Agente CEO...\n');

  const marketContext = `ESTADO DEL SISTEMA: PRE_MARKET_SYNC (Wall Street Pre-Market ABIERTO, BYMA CERRADO).`;
  const userMandate = `MANDATO DEL USUARIO: Necesito saber si hubo novedades recientes (noticias de ayer o de hoy) sobre la tasa de interés de la FED (Reserva Federal) y cómo podría impactar en el SPY (S&P 500). Basado en eso, fíjate cuánto dinero tenemos en Alpaca y propón un trade especulativo para la apertura (usa tu RiskEngine interno para calcular el tamaño).`;

  let promptContext = CEO_MANDATE;
  promptContext += `\n\n**Contexto de Mercado Actual:**\n${marketContext}`;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: promptContext },
    { role: 'user', content: userMandate },
  ];

  let iteration = 1;
  const maxIterations = 5; // Para prevenir loops infinitos
  let isDone = false;
  let lastToolCallName = '';
  let repeatedToolCallCount = 0;

  while (!isDone && iteration <= maxIterations) {
    console.log(`\n--- Iteración ${iteration} ---`);
    console.log('Enviando petición a Groq...');

    const response = await groqClient.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages,
      tools: [getVenueBalanceTool, serperSearchTool, tavilyResearchTool, getMarketPriceTool],
    });

    const responseMessage = response.choices[0]?.message;

    if (!responseMessage) {
      console.log('No hubo respuesta del modelo.');
      break;
    }

    messages.push(responseMessage); // Guardamos la respuesta del asistente en el historial

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      console.log('\n[Tool Calls detectadas]:');
      for (const toolCall of responseMessage.tool_calls) {
        console.log(` -> Llamando a ${toolCall.function.name} con args: ${toolCall.function.arguments}`);
        
        let toolResult: any;

        // Circuit Breaker Básico
        if (toolCall.function.name === lastToolCallName) {
          repeatedToolCallCount++;
        } else {
          lastToolCallName = toolCall.function.name;
          repeatedToolCallCount = 1;
        }

        if (repeatedToolCallCount > 3) {
          console.log(`\n[Circuit Breaker Activado]: El agente intentó usar ${toolCall.function.name} más de 3 veces consecutivas. Cortando ejecución.`);
          isDone = true;
          break; // Break the for loop
        }

        if (toolCall.function.name === 'get_venue_balance') {
          toolResult = await executeGetVenueBalance(toolCall.function.arguments);
        } else if (toolCall.function.name === 'serper_search') {
          toolResult = await executeSerperSearch(toolCall.function.arguments);
        } else if (toolCall.function.name === 'tavily_research') {
          toolResult = await executeTavilyResearch(toolCall.function.arguments);
        } else if (toolCall.function.name === 'get_market_price') {
          toolResult = await executeGetMarketPrice(toolCall.function.arguments);
        } else {
          toolResult = { error: `Herramienta desconocida: ${toolCall.function.name}` };
        }

        console.log(` <- Resultado de ${toolCall.function.name}:`, JSON.stringify(toolResult, null, 2).substring(0, 500) + '...');
        
        const toolMessage: ChatCompletionToolMessageParam = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        };
        
        messages.push(toolMessage);
      }
      iteration++;
    } else {
      console.log('\n[Respuesta final del CEO Agente]:\n');
      console.log(responseMessage.content);
      
      try {
        await logExecution({
          eventType: 'AGENT_CONCLUSION',
          details: { content: responseMessage.content }
        });
        console.log('\n[Log]: Respuesta guardada en el ExecutionLog (Trading Journal).');
      } catch (logError) {
        // Silent catch para no romper el bucle principal
      }

      isDone = true;
    }
  }

  if (iteration > maxIterations) {
    console.log('\nAlerta: Se alcanzó el número máximo de iteraciones sin una respuesta final.');
  }
}

runTest().catch(console.error);
