import { prisma } from '@/shared/lib/prisma';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedBalance, getUnifiedPositions } from '@/features/venues/venue.service';

export const getAccountStateTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_account_state',
    description: 'Obtiene el saldo actual de la cuenta consolidado desde los brokers (Venues), las POSICIONES ABIERTAS, el capital disponible y los desafíos/objetivos activos.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export async function executeGetAccountState() {
  const [alpacaBalance, bybitBalance, challenges, alpacaPositions, bybitPositions, dbPositions] = await Promise.all([
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
    prisma.position.findMany() // Obtener estrategias guardadas
  ]);

  const totalCash = (alpacaBalance?.cash ?? 0) + (bybitBalance?.cash ?? 0);

  // Mapear estrategias a posiciones vivas
  const getStrategy = (venue: string, symbol: string) => {
    const saved = dbPositions?.find((p) => p.venue === venue && p.symbol === symbol);
    return saved?.strategy || 'LONG_TERM'; // Por defecto LONG_TERM
  };

  const enrichedAlpaca = alpacaPositions.map(p => ({ ...p, strategy: getStrategy('alpaca', p.symbol) }));
  const enrichedBybit = bybitPositions.map(p => ({ ...p, strategy: getStrategy('bybit', p.symbol) }));

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
  };
}
