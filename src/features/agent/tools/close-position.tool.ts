import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedPositions, executeOrder, VenueName, getInstrumentInfo, cancelAllOrders } from '@/features/venues/venue.service';
import { prisma } from '@/shared/lib/prisma';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import { MissionService } from '@/features/agent/services/mission.service';

export const closePositionSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe('Venue donde se encuentra la posición'),
  symbol: z.string().describe('Símbolo del activo a cerrar (ej. BTCUSDT)'),
  percentage: z.coerce.number().min(1).max(100).describe('Porcentaje de la posición a cerrar (1-100). Usa 100 para cerrar todo.'),
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

    // Normalizar qty para Bybit utilizando la API dinámica
    if (params.venue === 'bybit') {
      const info = await getInstrumentInfo(params.venue as VenueName, params.symbol);
      const precision = info.qtyStep.toString().split('.')[1]?.length || 0;
      qtyToClose = Number((Math.floor(qtyToClose / info.qtyStep) * info.qtyStep).toFixed(precision));
    }

    if (qtyToClose <= 0) {
      return JSON.stringify({ error: "La cantidad a cerrar es demasiado pequeña después de la normalización." });
    }

    const side = isShort ? 'buy' : 'sell';

    // Estimar PnL Realizado antes de cerrar
    const realizedPnlEstimate = (position.unrealizedPl || 0) * (params.percentage / 100);
    await MissionService.addLifetimeCeoPnL(params.venue as VenueName, realizedPnlEstimate);

    // Ejecutar la orden de cierre
    await cancelAllOrders(params.venue as VenueName, params.symbol, 'linear').catch(() => {});
    const result = await executeOrder(params.venue as VenueName, {
      symbol: params.symbol,
      side: side,
      qty: qtyToClose,
      type: 'market', // Siempre a mercado para asegurar el cierre
      category: 'linear', // Asumimos futures para crypto por ahora
      reduceOnly: true
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
    console.error(`${LOG_PREFIX.BROKER_ERROR} ${ANSI_COLORS.RED}❌ Error en close_position: ${error.message}${ANSI_COLORS.RESET}`);
    return JSON.stringify({ error: error.message });
  }
}
