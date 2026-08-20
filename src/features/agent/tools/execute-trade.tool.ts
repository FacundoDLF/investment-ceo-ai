import { z } from 'zod';
import { executeOrder, VenueName } from '@/features/venues/venue.service';

export const executeTradeSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe('Venue donde se ejecutará la orden'),
  symbol: z.string().describe('Símbolo del activo (ej. AAPL, BTCUSDT)'),
  side: z.enum(['buy', 'sell']).describe('Dirección de la orden'),
  qty: z.number().positive().describe('Cantidad a operar'),
  type: z.enum(['market', 'limit']).describe('Tipo de orden'),
  limitPrice: z.number().positive().optional().describe('Precio límite (requerido si type es limit)'),
  stopLoss: z.number().positive().optional().describe('Precio de Stop Loss para orden OCO'),
  takeProfit: z.number().positive().optional().describe('Precio de Take Profit para orden OCO'),
});

export const executeTradeTool = {
  type: 'function' as const,
  function: {
    name: 'execute_trade',
    description: 'Ejecuta una orden de compra o venta en el broker especificado. Permite configuración de Stop Loss y Take Profit (OCO).',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', enum: ['alpaca', 'bybit'] },
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        qty: { type: 'number' },
        type: { type: 'string', enum: ['market', 'limit'] },
        limitPrice: { type: 'number' },
        stopLoss: { type: 'number' },
        takeProfit: { type: 'number' },
      },
      required: ['venue', 'symbol', 'side', 'qty', 'type'],
    },
  },
};

export async function executeExecuteTrade(args: string) {
  try {
    const parsedArgs = JSON.parse(args);
    const params = executeTradeSchema.parse(parsedArgs);

    // SAFETY SWITCH
    if (process.env.PAPER_MODE_ONLY === 'true' || process.env.PAPER_MODE_ONLY === undefined) {
      console.warn(`[SAFETY SWITCH] Ejecución simulada de orden en ${params.venue} para ${params.symbol}. Parámetros:`, params);
      return JSON.stringify({
        status: 'SIMULACIÓN EXITOSA',
        message: 'La orden no fue enviada al broker por el Safety Switch (PAPER_MODE_ONLY=true).',
        simulatedParams: params
      });
    }

    const result = await executeOrder(params.venue as VenueName, {
      symbol: params.symbol,
      side: params.side,
      qty: params.qty,
      type: params.type,
      limitPrice: params.limitPrice,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
    });

    return JSON.stringify(result);
  } catch (error: any) {
    console.error('Error en execute_trade:', error);
    return JSON.stringify({ error: error.message });
  }
}
