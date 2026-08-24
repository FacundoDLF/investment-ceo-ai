import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';

export const commandScrappySchema = z.object({
  action: z.enum(['START', 'STOP', 'UPDATE']).describe('Acción a tomar sobre Scrappy'),
  asset: z.string().optional().describe('Símbolo del activo a operar (ej. BTCUSDT)'),
  budget: z.coerce.number().optional().describe('Presupuesto máximo en USDT que Scrappy tiene permitido usar (ej. 100)'),
  target: z.coerce.number().optional().describe('Retorno objetivo en USDT exigido a Scrappy (ej. 20)'),
  reason: z.string().describe('Motivo de la decisión en una sola palabra')
});

export const commandScrappyTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'command_scrappy',
    description: 'Envía órdenes al Sub-Agente Scrappy (Scalper de Alta Frecuencia). Úsalo para encenderlo, apagarlo, o cambiar su activo, presupuesto y meta de ganancias (target).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['START', 'STOP', 'UPDATE'] },
        asset: { type: 'string' },
        budget: { type: 'number' },
        target: { type: 'number' },
        reason: { type: 'string' }
      },
      required: ['action', 'reason'],
    },
  },
};

export async function executeCommandScrappy(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const result = commandScrappySchema.safeParse(parsedArgs);
    
    if (!result.success) {
      return JSON.stringify({ error: "Validation Error", details: result.error.issues });
    }
    
    const { action, asset, budget, target } = result.data;

    let active = StateService.getScrappyState().active;
    if (action === 'START') active = true;
    if (action === 'STOP') active = false;

    StateService.setScrappyConfig(active, asset, budget, target);

    return JSON.stringify({
      success: true,
      message: `Scrappy configurado. Estado: ${active ? 'ACTIVO' : 'APAGADO'}${asset ? `, Activo: ${asset.toUpperCase()}` : ''}${budget ? `, Presupuesto: ${budget}` : ''}${target ? `, Meta: ${target}` : ''}`
    });

  } catch (error: any) {
    console.error('Error en command_scrappy:', error);
    return JSON.stringify({ error: error.message });
  }
}
