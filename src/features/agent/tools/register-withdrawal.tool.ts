import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { MissionService } from '../services/mission.service';
import { VenueName } from '../../venues/venue.service';

export const registerWithdrawalSchema = z.object({
  venue: z.string().describe('El broker del cual el humano retiró el dinero (ej. "alpaca", "bybit")'),
  amount: z.coerce.number().describe('La cantidad exacta en dólares (USD) que el humano retiró a su cuenta bancaria')
});

export const registerWithdrawalTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'register_withdrawal',
    description: 'Usa esta herramienta cuando el humano te notifique que ha transferido su dinero de la Reserva Intocable a su cuenta bancaria real. Esto es vital para deducir el monto de la caja fuerte virtual y mantener la contabilidad del Patrimonio Efectivo cuadrada, evitando que el bot piense que hubo una pérdida de capital masiva.',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string' },
        amount: { type: 'number' }
      },
      required: ['venue', 'amount'],
    },
  },
};

export async function executeRegisterWithdrawal(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const result = registerWithdrawalSchema.safeParse(parsedArgs);
    
    if (!result.success) {
      return JSON.stringify({ error: "Validation Error", details: result.error.issues });
    }
    
    const { venue, amount } = result.data;
    
    const validVenues = ["alpaca", "bybit"];
    if (!validVenues.includes(venue)) {
      return JSON.stringify({ error: "Broker inválido. Debe ser 'alpaca' o 'bybit'." });
    }

    const currentFrozen = await MissionService.getFrozenReserve(venue as VenueName);
    
    if (amount <= 0) {
      return JSON.stringify({ error: "El monto debe ser mayor a 0." });
    }

    let message = "";
    if (amount > currentFrozen) {
      message = `[ADVERTENCIA] El humano indicó que retiró $${amount}, pero la reserva congelada actual es de solo $${currentFrozen}. Se reducirá la reserva a 0, pero esto podría indicar una descapitalización del Patrimonio Neto base.\n`;
    }

    const newFrozen = Math.max(0, currentFrozen - amount);
    await MissionService.setFrozenReserve(venue as VenueName, newFrozen);

    return JSON.stringify({
      success: true,
      message: message + `[ÉXITO] Se ha registrado el retiro físico de $${amount} USD en ${venue.toUpperCase()}. Reserva anterior: $${currentFrozen.toFixed(2)}. Nueva Reserva Intocable restante: $${newFrozen.toFixed(2)}. La matemática del Patrimonio Efectivo está a salvo.`
    });

  } catch (error: any) {
    console.error('Error en register_withdrawal:', error);
    return JSON.stringify({ error: error.message });
  }
}
