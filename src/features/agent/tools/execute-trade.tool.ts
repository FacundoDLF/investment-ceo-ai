import { z } from 'zod';
import { executeOrder, getUnifiedBalance, getMarketPrice, VenueName } from '@/features/venues/venue.service';

import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';

export const executeTradeSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe('Venue donde se ejecutará la orden'),
  symbol: z.string().describe('Símbolo del activo (ej. AAPL, BTCUSDT)'),
  side: z.enum(['buy', 'sell']).describe('Dirección de la orden'),
  qty: z.number().positive().describe('Cantidad a operar'),
  type: z.enum(['market', 'limit']).describe('Tipo de orden'),
  limitPrice: z.preprocess((val) => (val === 'None' || val === null || val === '') ? undefined : val, z.coerce.number().positive().optional()).describe('Precio límite (requerido si type es limit)'),
  stopLoss: z.preprocess((val) => (val === 'None' || val === null || val === '') ? undefined : val, z.coerce.number().positive().optional()).describe('Precio de Stop Loss para orden OCO'),
  takeProfit: z.preprocess((val) => (val === 'None' || val === null || val === '') ? undefined : val, z.coerce.number().positive().optional()).describe('Precio de Take Profit para orden OCO'),
  category: z.enum(['spot', 'linear']).optional().describe('Categoría de mercado (spot o linear/futuros). Por defecto linear.'),
  strategy: z.enum(['LONG_TERM', 'INTRADAY']).describe('Estrategia de la operación'),
  thesis: z.string().min(15, "La tesis es obligatoria y debe tener al menos 15 caracteres descriptivos").max(300).describe('Breve tesis de inversión justificando este trade (Obligatorio para la auditoría de portafolio)'),
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
        limitPrice: { type: ['number', 'null', 'string'] },
        stopLoss: { type: ['number', 'null', 'string'] },
        takeProfit: { type: ['number', 'null', 'string'] },
        category: { type: 'string', enum: ['spot', 'linear'] },
        strategy: { type: 'string', enum: ['LONG_TERM', 'INTRADAY'] },
        thesis: { type: 'string', minLength: 15, maxLength: 300, description: 'Debes proveer una tesis real descriptiva, no un texto vacío.' },
      },
      required: ['venue', 'symbol', 'side', 'qty', 'type', 'strategy', 'thesis'],
    },
  },
};

export async function executeExecuteTrade(args: string) {
  try {
    const parsedArgs = JSON.parse(args);
    
    const parsedResult = executeTradeSchema.safeParse(parsedArgs);
    if (!parsedResult.success) {
      return JSON.stringify({ error: "Validation Error", details: parsedResult.error.issues });
    }
    const params = parsedResult.data;

    // Normalizar qty para Bybit para evitar "Qty invalid" (Redondeo a 0)
    if (params.venue === 'bybit') {
      if (params.symbol === 'BTCUSDT') {
        params.qty = Math.floor(params.qty * 100000) / 100000; // 5 decimales
      } else if (params.symbol === 'ETHUSDT') {
        params.qty = Math.floor(params.qty * 10000) / 10000; // 4 decimales
      } else {
        params.qty = Math.floor(params.qty * 100) / 100; // 2 decimales
      }
      
      if (params.qty <= 0) {
        return JSON.stringify({ error: `La cantidad calculada (${params.qty}) es inválida o se redondeó a cero. Aumenta el monto a invertir o verifica el mínimo del exchange.` });
      }
    }

    // PRE-FLIGHT CHECK: Verificar fondos disponibles antes de enviar a Bybit/Alpaca
    if (params.side === 'buy') {
      try {
        const balance = await getUnifiedBalance(params.venue as VenueName);
        const marketPrice = await getMarketPrice(params.venue as VenueName, params.symbol);
        const estimatedCost = params.qty * marketPrice.ask; // Estimamos con el precio ask (compra)
        
        if (params.category === 'spot') {
          const quoteCoin = params.symbol.endsWith('USDT') ? 'USDT' : params.symbol.endsWith('USDC') ? 'USDC' : 'USDT';
          const quoteBalance = balance.coins?.find(c => c.symbol === quoteCoin)?.balance || 0;
          if (estimatedCost > quoteBalance) {
            return JSON.stringify({ 
              error: `Pre-Flight Check Falló: Saldo Spot Insuficiente. Intentas comprar ~$${estimatedCost.toFixed(2)} de ${params.symbol}, pero solo tienes $${quoteBalance.toFixed(2)} en ${quoteCoin}. Si deseas usar liquidez de Futuros, cambia category a 'linear'.`
            });
          }
        } else {
          // Si es linear (futuros), verificamos a muy alto nivel. El exchange igual puede frenarlo por max_qty
          const availableFutures = balance.dayTradingPower || 0;
          if (estimatedCost > availableFutures * 100) { // Asumiendo apalancamiento alto como extremo
            return JSON.stringify({
               error: `Pre-Flight Check Falló: Operación demasiado grande para tu Poder de Futuros. Considera reducir drásticamente el 'qty'.`
            });
          }
        }
      } catch (e: any) {
        console.warn('No se pudo verificar el Pre-Flight check, continuando con la orden bajo propio riesgo...', e.message);
      }
    }

    // La validación de PAPER_MODE_ONLY ahora se realiza dentro de los adaptadores (alpaca.adapter.ts y bybit.adapter.ts)
    // ruteando la petición a las URLs y credenciales de Demo/Paper.
    if (process.env.PAPER_MODE_ONLY === 'true' || process.env.PAPER_MODE_ONLY === undefined) {
      console.info(`${ANSI_COLORS.YELLOW}[PAPER MODE]${ANSI_COLORS.RESET} 📝 Enviando orden simulada en ${params.venue} para ${params.symbol}...`);
    }

    const result = await executeOrder(params.venue as VenueName, {
      symbol: params.symbol,
      side: params.side,
      qty: params.qty,
      type: params.type,
      limitPrice: params.limitPrice || undefined,
      stopLoss: params.stopLoss || undefined,
      takeProfit: params.takeProfit || undefined,
      category: params.category || undefined
    });

    // Registrar en ExecutionLog local
    const { prisma } = require('@/shared/lib/prisma');
    await prisma.executionLog.create({
      data: {
        eventType: 'TRADE_ORDER',
        venue: params.venue,
        symbol: params.symbol,
        details: JSON.stringify(result),
        strategy: params.strategy,
        success: true
      }
    });

    if (params.side === 'buy') {
      await prisma.position.upsert({
        where: {
          venue_symbol: {
            venue: params.venue,
            symbol: params.symbol
          }
        },
        update: { strategy: params.strategy, thesis: params.thesis },
        create: {
          venue: params.venue,
          symbol: params.symbol,
          strategy: params.strategy,
          thesis: params.thesis
        }
      });
    }

    return JSON.stringify(result);
  } catch (error: any) {
    console.log(`${LOG_PREFIX.BROKER_ERROR} ${ANSI_COLORS.RED}❌ ${error.message}${ANSI_COLORS.RESET}`);
    return JSON.stringify({ error: error.message });
  }
}
