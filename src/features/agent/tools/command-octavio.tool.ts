import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';
import { getUnifiedBalance } from '@/features/venues/venue.service';
import { MissionService } from '../services/mission.service';

export const commandOctavioSchema = z.object({
  action: z.enum(['START', 'STOP', 'UPDATE']).describe('Acción a tomar sobre Octavio'),
  asset: z.string().optional().describe('Símbolo base del activo a operar opciones (ej. BTC)'),
  baseCapital: z.coerce.number().optional().describe('Base Imponible sobre la que se calculará el Budget final (ej. si pasas 5000, el Budget real será el 40%: 2000)'),
  resetPnL: z.enum(['true', 'false']).optional().describe('Texto plano "true" o "false". Si es "true", reinicia la alcancía (PnL) a 0.'),
  budgetMultiplier: z.coerce.number().optional().describe('Multiplicador porcentual para el presupuesto (defecto: 0.4)'),
  targetMultiplier: z.coerce.number().optional().describe('Multiplicador porcentual para la meta (defecto: 0.1)'),
  directive: z.string().optional().describe('Instrucción táctica del CEO (ej. "Prioriza opciones con Theta bajo y Delta alto").'),
  reason: z.string().describe('Motivo de la decisión en una sola palabra')
});

export const commandOctavioTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'command_octavio',
    description: 'Envía órdenes al Sub-Agente Octavio (Especialista en Opciones Crypto). Úsalo para encenderlo, apagarlo, o cambiar su activo base (ej. BTC).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['START', 'STOP', 'UPDATE'] },
        asset: { type: 'string' },
        baseCapital: { type: 'number' },
        budgetMultiplier: { type: 'number' },
        targetMultiplier: { type: 'number' },
        directive: { type: 'string' },
        resetPnL: { type: 'string', enum: ['true', 'false'] },
        reason: { type: 'string' }
      },
      required: ['action', 'reason'],
    },
  },
};

export async function executeCommandOctavio(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const result = commandOctavioSchema.safeParse(parsedArgs);
    
    if (!result.success) {
      return JSON.stringify({ error: "Validation Error", details: result.error.issues });
    }
    
    const { action, asset, baseCapital, budgetMultiplier, targetMultiplier, directive, resetPnL } = result.data;

    let active = StateService.getOctavioState().active;
    if (action === 'START') active = true;
    if (action === 'STOP') active = false;

    let budget: number | undefined = undefined;
    let target: number | undefined = undefined;

    if (baseCapital !== undefined && baseCapital > 0) {
      const bMult = budgetMultiplier !== undefined ? budgetMultiplier : 0.4;
      const tMult = targetMultiplier !== undefined ? targetMultiplier : 0.1;
      
      budget = baseCapital * bMult;
      
      try {
        const bybitBal = await getUnifiedBalance('bybit');
        const maxBudget = bybitBal.dayTradingPower * 0.9;
        if (budget > maxBudget && maxBudget > 0) {
          console.log(`[Octavio Safety] Budget auto-calculado de $${budget.toFixed(2)} excede el límite seguro. Topando a $${maxBudget.toFixed(2)}.`);
          budget = maxBudget;
        }
      } catch (e) {
        // Ignorar si falla la API
      }

      target = budget * tMult;
    }

    StateService.setOctavioConfig(active, asset, budget, target);
    
    if (directive) {
      StateService.setOctavioDirective(directive);
    }

    let pnlStatus = "";
    if (resetPnL === 'true') {
      await MissionService.resetOctavioPnL();
      pnlStatus = " -> Alcancía: $0.00";
    } else {
      const currentPnL = await MissionService.getOctavioPnL();
      pnlStatus = ` -> Alcancía retenida: $${currentPnL.toFixed(2)}`;
    }

    return JSON.stringify({
      success: true,
      message: `Octavio configurado. Estado: ${active ? 'ACTIVO' : 'APAGADO'}${asset ? `, Activo Base: ${asset.toUpperCase()}` : ''}${baseCapital ? `, Base Imponible: $${baseCapital}` : ''}${budget ? ` -> Budget Auto-calculado: $${budget.toFixed(2)}` : ''}${target ? ` -> Target Auto-calculado: $${target.toFixed(2)}` : ''}${directive ? ` -> Directiva enviada: "${directive}"` : ''}${pnlStatus}`
    });

  } catch (error: any) {
    console.error('Error en command_octavio:', error);
    return JSON.stringify({ error: error.message });
  }
}
