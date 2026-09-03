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
  const isIol = process.env.CEO_MODE === 'iol';
  const isCrypto = process.env.CEO_MODE === 'crypto';
  const isNormal = !isIol && !isCrypto;

  const [alpacaBalance, bybitBalance, iolBalance, challenges, alpacaPositions, bybitPositions, iolPositions, dbPositions, lastSnapshot] = await Promise.all([
    (isNormal) ? getUnifiedBalance('alpaca').catch((e) => {
      console.warn('Error obteniendo balance de Alpaca:', e.message);
      return null;
    }) : Promise.resolve(null),
    (isNormal || isCrypto) ? getUnifiedBalance('bybit').catch((e) => {
      console.warn('Error obteniendo balance de Bybit:', e.message);
      return null;
    }) : Promise.resolve(null),
    (isIol) ? getUnifiedBalance('iol') : Promise.resolve(null),
    prisma.challenge.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        title: true,
        targetMetric: true,
      },
    }),
    (isNormal) ? getUnifiedPositions('alpaca').catch((e) => {
      console.warn('Error obteniendo posiciones de Alpaca:', e.message);
      return [];
    }) : Promise.resolve([]),
    (isNormal || isCrypto) ? getUnifiedPositions('bybit').catch((e) => {
      console.warn('Error obteniendo posiciones de Bybit:', e.message);
      return [];
    }) : Promise.resolve([]),
    (isIol) ? getUnifiedPositions('iol') : Promise.resolve([]),
    prisma.position.findMany(), // Obtener estrategias guardadas
    prisma.performanceSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
  ]);

  const totalCash = (alpacaBalance?.cash ?? 0) + (bybitBalance?.cash ?? 0) + (iolBalance?.cash ?? 0);

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
  const enrichedIol = iolPositions.map(p => ({ ...p, ...getPositionMeta('iol', p.symbol) }));

  return {
    consolidatedBalance: {
      totalCash,
      alpaca: alpacaBalance,
      bybit: bybitBalance,
      iol: iolBalance
    },
    positions: {
      alpaca: enrichedAlpaca,
      bybit: enrichedBybit,
      iol: enrichedIol
    },
    challenges,
    scrappyState: StateService.getScrappyState(),
    scorecard: lastSnapshot
  };
}
