import { prisma } from '@/shared/lib/prisma';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedBalance, getUnifiedPositions } from '@/features/venues/venue.service';
import { StateService } from '../services/state.service';

export const getAccountStateTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_account_state',
    description: 'Obtiene el saldo actual de la cuenta consolidado desde los brokers (Venues), el PORTAFOLIO SPOT (Monedas en Cartera), las POSICIONES ABIERTAS (Derivados), el capital disponible y los desafíos/objetivos activos.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export async function executeGetAccountState() {
  const [alpacaBalance, bybitBalance, challenges, alpacaPositions, bybitPositions, dbPositions, lastSnapshot] = await Promise.all([
    getUnifiedBalance('alpaca').catch((e) => {
      console.warn('Error obteniendo balance de Alpaca:', e.message);
      return null;
    }),
    getUnifiedBalance('bybit').catch((e) => {
      console.warn('Error obteniendo balance de Bybit:', e.message);
      return null;
    }),
    prisma.challenge.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        title: true,
        targetMetric: true,
      },
    }),
    getUnifiedPositions('alpaca').catch((e) => {
      console.warn('Error obteniendo posiciones de Alpaca:', e.message);
      return [];
    }),
    getUnifiedPositions('bybit').catch((e) => {
      console.warn('Error obteniendo posiciones de Bybit:', e.message);
      return [];
    }),
    prisma.position.findMany(), // Obtener estrategias guardadas
    prisma.performanceSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
  ]);

  const totalCash = (alpacaBalance?.cash ?? 0) + (bybitBalance?.cash ?? 0);

  // Mapear estrategias a posiciones vivas
  const getPositionMeta = (venue: string, symbol: string) => {
    const saved = dbPositions?.find((p) => p.venue === venue && p.symbol === symbol);
    return {
      strategy: saved?.strategy || 'LONG_TERM',
      thesis: saved?.thesis || 'No hay tesis registrada.'
    };
  };

  const enrichedAlpaca = alpacaPositions.map(p => ({ ...p, ...getPositionMeta('alpaca', p.symbol) }));
  const enrichedBybit = bybitPositions.map(p => ({ ...p, ...getPositionMeta('bybit', p.symbol) }));

  return {
    consolidatedBalance: {
      totalCash,
      alpaca: alpacaBalance,
      bybit: bybitBalance,
    },
    positions: {
      alpaca: enrichedAlpaca,
      bybit: enrichedBybit,
    },
    challenges,
    scrappyState: StateService.getScrappyState(),
    scorecard: lastSnapshot
  };
}
