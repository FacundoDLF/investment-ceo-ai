import { z } from 'zod';
import { createChatCompletionWithRetry, ExtendedChatCompletionParams } from '@/shared/lib/groq';

export const consultAnalystSchema = z.object({
  duda: z.string().describe('Tu duda, consulta o análisis parcial sobre el cual necesitas consejo estratégico del Agente Inteligente.'),
});

export const consultAnalystTool = {
  type: 'function' as const,
  function: {
    name: 'consult_smart_analyst',
    description: 'Permite consultar a un modelo más lento e inteligente (Claude 3.5 Sonnet) si no estás seguro de una decisión. Usa esto como último recurso si el mercado está muy ambiguo.',
    parameters: {
      type: 'object',
      properties: {
        duda: { type: 'string' },
      },
      required: ['duda'],
    },
  },
};

export async function executeConsultAnalyst(args: string, marketContext: string): Promise<string> {
  try {
    const parsedArgs = JSON.parse(args);
    const params = consultAnalystSchema.parse(parsedArgs);

    console.log(`\${LOG_PREFIX.EXPERTO_SMART} Analizando consulta táctica del CEO Trader...`);

    const promptContext = `Eres el Analista Senior (Smart Agent) del fondo. El CEO rápido (HFT) tiene una duda y necesita tu consejo profundo y analítico.
Contexto de Mercado:
${marketContext}`;

    const response = await createChatCompletionWithRetry({
      model: 'meta-llama/llama-3.3-70b-instruct',
      fallbackModels: [
        'qwen/qwen-2.5-72b-instruct',
        'google/gemma-4-31b-it:free',
        'z-ai/glm-5.2:free',
        'openrouter/free'
      ],
      messages: [
        { role: 'system', content: promptContext },
        { role: 'user', content: `Consulta del CEO: ${params.duda}\nAnaliza la situación y dame una recomendación clara de sí/no o qué parámetros ajustar.` }
      ]
    });

    console.log(`\${LOG_PREFIX.EXPERTO_SMART} Análisis finalizado. Entregando reporte...`);

    return JSON.stringify({
      success: true,
      recomendacion: response.choices[0]?.message?.content || 'No se obtuvo respuesta.'
    });
  } catch (error: any) {
    console.error('Error en consult_smart_analyst:', error);
    return JSON.stringify({ error: error.message });
  }
}
