import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';

export const commandScrappySchema = z.object({
  action: z.enum(['START', 'STOP', 'UPDATE']).describe('Acción a tomar sobre Scrappy'),
  asset: z.string().optional().describe('Símbolo del activo a operar (ej. BTCUSDT)'),
  baseCapital: z.coerce.number().optional().describe('Base Imponible en USDT sobre la que se calculará el presupuesto y la meta (ej. 1000)'),
  budgetMultiplier: z.coerce.number().optional().describe('Multiplicador porcentual para el presupuesto (defecto: 0.2, es decir 20% cada $1000 de Base)'),
  targetMultiplier: z.coerce.number().optional().describe('Multiplicador porcentual para la meta (defecto: 0.1, es decir 10% del presupuesto)'),
  reason: z.string().describe('Motivo de la decisión en una sola palabra')
});

export const commandScrappyTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'command_scrappy',
    description: 'Envía órdenes al Sub-Agente Scrappy (Scalper de Alta Frecuencia). Úsalo para encenderlo, apagarlo, o cambiar su activo y Base Imponible.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['START', 'STOP', 'UPDATE'] },
        asset: { type: 'string' },
        baseCapital: { type: 'number' },
        budgetMultiplier: { type: 'number' },
        targetMultiplier: { type: 'number' },
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
    
    const { action, asset, baseCapital, budgetMultiplier, targetMultiplier } = result.data;

    let active = StateService.getScrappyState().active;
    if (action === 'START') active = true;
    if (action === 'STOP') active = false;

    let budget: number | undefined = undefined;
    let target: number | undefined = undefined;

    if (baseCapital !== undefined && baseCapital > 0) {
      const bMult = budgetMultiplier !== undefined ? budgetMultiplier : 0.2;
      const tMult = targetMultiplier !== undefined ? targetMultiplier : 0.1;
      
      // Fórmula de Riesgo Escalonada: Budget = BaseCapital * ((BaseCapital / 1000) * budgetMultiplier)
      budget = baseCapital * ((baseCapital / 1000) * bMult);
      target = budget * tMult;
    }

    StateService.setScrappyConfig(active, asset, budget, target);

    return JSON.stringify({
      success: true,
      message: `Scrappy configurado. Estado: ${active ? 'ACTIVO' : 'APAGADO'}${asset ? `, Activo: ${asset.toUpperCase()}` : ''}${baseCapital ? `, Base Imponible: $${baseCapital}` : ''}${budget ? ` -> Budget Auto-calculado: $${budget.toFixed(2)}` : ''}${target ? ` -> Target Auto-calculado: $${target.toFixed(2)}` : ''}`
    });

  } catch (error: any) {
    console.error('Error en command_scrappy:', error);
    return JSON.stringify({ error: error.message });
  }
}
