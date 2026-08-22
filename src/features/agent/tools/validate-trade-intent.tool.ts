import { z } from 'zod';
import { getUnifiedBalance, getMarketPrice, VenueName } from '@/features/venues/venue.service';

export const validateTradeIntentSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe('Venue donde se planea ejecutar'),
  symbol: z.string().describe('Símbolo del activo (ej. BTCUSDT)'),
  side: z.enum(['buy', 'sell']).describe('Dirección de la orden planificada'),
  qty: z.coerce.number().positive().describe('Cantidad planificada'),
  category: z.enum(['spot', 'linear']).optional().describe('Categoría del mercado'),
});

export const validateTradeIntentTool = {
  type: 'function' as const,
  function: {
    name: 'validate_trade_intent',
    description: 'PASO 1 OBLIGATORIO ANTES DE EJECUTAR TRADE. Simula y pre-valida matemáticamente si la operación es viable según el saldo exacto y las restricciones del broker.',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', enum: ['alpaca', 'bybit'] },
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        qty: { type: 'number' },
        category: { type: 'string', enum: ['spot', 'linear'] },
      },
      required: ['venue', 'symbol', 'side', 'qty'],
    },
  },
};

export async function executeValidateTradeIntent(args: string) {
  try {
    const parsedArgs = JSON.parse(args);
    const parsedResult = validateTradeIntentSchema.safeParse(parsedArgs);
    if (!parsedResult.success) {
      return JSON.stringify({ error: "Validation Error", details: parsedResult.error.issues });
    }
    const params = parsedResult.data;

    let qty = params.qty;
    if (params.venue === 'bybit') {
      if (params.symbol === 'BTCUSDT') qty = Math.floor(qty * 1000) / 1000;
      else if (params.symbol === 'ETHUSDT') qty = Math.floor(qty * 100) / 100;
      else qty = Math.floor(qty);
    }

    if (params.side === 'buy') {
      const balance = await getUnifiedBalance(params.venue as VenueName);
      const marketPrice = await getMarketPrice(params.venue as VenueName, params.symbol);
      const estimatedCost = qty * marketPrice.ask;

      if (params.category === 'spot') {
        const availableSpot = balance.spotPower || 0;
        if (estimatedCost > availableSpot) {
          return JSON.stringify({ 
            status: "REJECTED",
            reason: `SALDO INSUFICIENTE. Necesitas ~$${estimatedCost.toFixed(2)} en liquidez pura (USDT), pero tu poder Spot disponible es $${availableSpot.toFixed(2)}. SUGERENCIA: Reduce el 'qty' drásticamente o cambia la categoría a 'linear' para aprovechar el apalancamiento.`
          });
        }
      } else {
        const availableFutures = balance.dayTradingPower || 0;
        if (estimatedCost > availableFutures * 50) { 
          return JSON.stringify({
             status: "REJECTED",
             reason: `APALANCAMIENTO EXCESIVO. El valor nominal ($${estimatedCost.toFixed(2)}) supera con creces tu margen seguro ($${availableFutures.toFixed(2)}). SUGERENCIA: Reduce el 'qty'.`
          });
        }
      }
    }

    return JSON.stringify({
      status: "APPROVED_TECHNICAL",
      message: `La operación simulada (${params.side} ${qty} ${params.symbol} en ${params.category || 'linear'}) pasó las pruebas técnicas de balance. PASO SIGUIENTE: Llama a 'consult_smart_analyst' para confirmar estratégicamente.`
    });
  } catch (error: any) {
    console.error('Error en validate_trade_intent:', error);
    return JSON.stringify({ error: error.message });
  }
}
