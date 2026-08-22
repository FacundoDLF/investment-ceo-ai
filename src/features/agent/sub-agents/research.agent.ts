import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { serperSearchTool, executeSerperSearch } from '@/features/agent/tools/serper-search.tool';
import { tavilyResearchTool, executeTavilyResearch } from '@/features/agent/tools/tavily-research.tool';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

const RESEARCH_MANDATE = `Eres el Research Agent del fondo cuantitativo.
Tu único propósito es utilizar tus herramientas de búsqueda para sintetizar el contexto macroeconómico actual y eventos que afecten los mercados.
Debes retornar un informe estructurado y conciso en texto con los hallazgos clave. No asumas ni inventes datos.

PROHIBICIÓN ESTRICTA: Solo puedes usar las herramientas provistas explícitamente (serper_search y tavily_research). NO intentes invocar herramientas inexistentes como 'open_file', 'browser' o 'read_url'. Basate únicamente en el contenido de los resúmenes que te devuelven tus herramientas.`;

export async function runResearchAgent(query: string): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: RESEARCH_MANDATE },
    { role: 'user', content: query }
  ];

  console.log('\x1b[35m[Richard Newman]\x1b[0m Iniciando investigación sobre:', query);

  let response = await createChatCompletionWithRetry({
    model: 'meta-llama/llama-3.3-70b-instruct',
    fallbackModels: [
      'qwen/qwen-2.5-72b-instruct'
    ],
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
      console.log(`\x1b[35m[Richard Newman]\x1b[0m Ejecutando herramienta: ${toolCall.function.name}`);
      let toolResult = '';
      
      try {
        if (toolCall.function.name === 'serper_search') {
          const result = await executeSerperSearch(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
        } else if (toolCall.function.name === 'tavily_research') {
          const result = await executeTavilyResearch(toolCall.function.arguments);
          toolResult = JSON.stringify(result);
        } else {
          toolResult = `Herramienta desconocida: ${toolCall.function.name}`;
        }
      } catch (error: any) {
        console.error('\x1b[31m[Richard Newman] Error crítico:\x1b[0m', error.message);
        throw error;
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
      tools: [serperSearchTool, tavilyResearchTool],
    });
    responseMessage = response.choices[0]?.message;
    iterations++;
  }

  return responseMessage?.content || 'No se pudo generar un reporte de investigación.';
}
