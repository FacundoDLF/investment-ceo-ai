import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { serperSearchTool, executeSerperSearch } from '@/features/agent/tools/serper-search.tool';
import { tavilyResearchTool, executeTavilyResearch } from '@/features/agent/tools/tavily-research.tool';
import { getFriendlyToolName } from '@/shared/utils/tool-names';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';

const RESEARCH_MANDATE = `Eres el Research Agent del fondo cuantitativo.
Tu único propósito es utilizar tus herramientas de búsqueda para sintetizar el contexto macroeconómico actual y eventos que afecten los mercados.
Debes retornar un informe estructurado y conciso en texto con los hallazgos clave. No asumas ni inventes datos.

PROHIBICIÓN ESTRICTA: Solo puedes usar las herramientas provistas explícitamente (serper_search y tavily_research). NO intentes invocar herramientas inexistentes como 'open_file', 'browser' o 'read_url'. Basate únicamente en el contenido de los resúmenes que te devuelven tus herramientas.`;

export async function runResearchAgent(query: string): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: RESEARCH_MANDATE },
    { role: 'user', content: query }
  ];

  console.log(`${LOG_PREFIX.RICHARD_NEWMAN} Iniciando investigación sobre:`, query);

  let response = await createChatCompletionWithRetry({
    role: 'ANALYST',
    messages,
    tools: [serperSearchTool, tavilyResearchTool],
  });

  let responseMessage = response.choices[0]?.message;

  let iterations = 0;
  while (responseMessage?.tool_calls && iterations < 3) {
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
      console.log(`${ANSI_COLORS.MAGENTA}[Richard Newman]${ANSI_COLORS.RESET} ${getFriendlyToolName(toolCall.function.name)}`);
      let toolResult = '';
      
      try {
        if (toolCall.function.name === 'serper_search') {
          console.log(`${LOG_PREFIX.RICHARD_NEWMAN} Informando...`);
          const result = await executeSerperSearch(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
          try {
             const q = JSON.parse(toolCall.function.arguments).query || "Búsqueda web";
             const shortQuery = q.split(' ').slice(0, 3).join(' ');
             console.log(`${ANSI_COLORS.MAGENTA}[Richard Newman]${ANSI_COLORS.RESET} CEO Informado. Tema: ${shortQuery}`);
          } catch(e) {}
        } else if (toolCall.function.name === 'tavily_research') {
          const result = await executeTavilyResearch(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
        } else {
          toolResult = `Herramienta desconocida: ${toolCall.function.name}`;
        }
      } catch (error: any) {
        console.error(`${LOG_PREFIX.SISTEMA_CRITICO} [Richard Newman] Error crítico:${ANSI_COLORS.RESET}`, error.message);
        throw error;
      }
      
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    response = await createChatCompletionWithRetry({
      role: 'ANALYST',
      messages,
      tools: [serperSearchTool, tavilyResearchTool],
    });
    responseMessage = response.choices[0]?.message;
    iterations++;
  }

  const finalReport = responseMessage?.content || 'No se pudo generar un reporte de investigación.';
  if (finalReport) {
    // Tomamos solo la primera oración para mostrar en consola como resumen
    const firstSentence = finalReport.split('.')[0] + '.';
    console.log(`${ANSI_COLORS.MAGENTA}[Richard Newman]${ANSI_COLORS.RESET} Resumen de investigación: ${firstSentence}`);
  }
  return finalReport;
}
