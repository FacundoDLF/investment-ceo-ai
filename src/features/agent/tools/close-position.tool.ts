import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedPositions, executeOrder, VenueName } from '@/features/venues/venue.service';
import { prisma } from '@/shared/lib/prisma';

export const closePositionSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe('Venue donde se encuentra la posición'),
  symbol: z.string().describe('Símbolo del activo a cerrar (ej. BTCUSDT)'),
  percentage: z.number().min(1).max(100).describe('Porcentaje de la posición a cerrar (1-100). Usa 100 para cerrar todo.'),
  reason: z.string().max(300).describe('Breve justificación de por qué estás cerrando la posición (ej: Tesis fallida, Toma de ganancias)')
});

export const closePositionTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'close_position',
    description: 'Cierra una posición abierta total o parcialmente. Úsalo durante la Auditoría de Portafolio o en Modo Damage Control.',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', enum: ['alpaca', 'bybit'] },
        symbol: { type: 'string' },
        percentage: { type: 'number', description: '1 to 100' },
        reason: { type: 'string' }
      },
      required: ['venue', 'symbol', 'percentage', 'reason'],
    },
  },
};

export async function executeClosePosition(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const parsedResult = closePositionSchema.safeParse(parsedArgs);
    
    if (!parsedResult.success) {
      return JSON.stringify({ error: "Validation Error", details: parsedResult.error.issues });
    }
    const params = parsedResult.data;

    // Buscar la posición actual en el broker
    const positions = await getUnifiedPositions(params.venue as VenueName);
    const position = positions.find(p => p.symbol === params.symbol);

    if (!position || position.qty === 0) {
      return JSON.stringify({ error: `No se encontró una posición abierta para ${params.symbol} en ${params.venue}` });
    }

    // Calcular cantidad a cerrar
    const isShort = position.qty < 0;
    const absQty = Math.abs(position.qty);
    let qtyToClose = (absQty * params.percentage) / 100;

    // Normalizar qty para Bybit
    if (params.venue === 'bybit') {
      if (params.symbol === 'BTCUSDT') {
        qtyToClose = Math.floor(qtyToClose * 1000) / 1000;
      } else if (params.symbol === 'ETHUSDT') {
        qtyToClose = Math.floor(qtyToClose * 100) / 100;
      } else {
        qtyToClose = Math.floor(qtyToClose);
      }
    }

    if (qtyToClose <= 0) {
      return JSON.stringify({ error: "La cantidad a cerrar es demasiado pequeña después de la normalización." });
    }

    const side = isShort ? 'buy' : 'sell';

    // Ejecutar la orden de cierre
    const result = await executeOrder(params.venue as VenueName, {
      symbol: params.symbol,
      side: side,
      qty: qtyToClose,
      type: 'market', // Siempre a mercado para asegurar el cierre
      category: 'linear' // Asumimos futures para crypto por ahora
    });

    // Registrar en ExecutionLog local
    await prisma.executionLog.create({
      data: {
        eventType: 'TRADE_ORDER_CLOSE',
        venue: params.venue,
        symbol: params.symbol,
        details: JSON.stringify({
          action: `Cerrando ${params.percentage}% de la posición`,
          reason: params.reason,
          result: result
        }),
        success: true
      }
    });

    // Si cerró el 100%, eliminar la tesis de la DB local
    if (params.percentage === 100) {
      await prisma.position.deleteMany({
        where: { venue: params.venue, symbol: params.symbol }
      });
    }

    return JSON.stringify({
      success: true,
      message: `Cerrado el ${params.percentage}% de la posición (${qtyToClose} unidades).`,
      reason: params.reason,
      brokerResult: result
    });

  } catch (error: any) {
    console.error('Error en close_position:', error);
    return JSON.stringify({ error: error.message });
  }
}
