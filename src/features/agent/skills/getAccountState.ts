import { prisma } from '@/shared/lib/prisma';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedBalance } from '@/features/venues/venue.service';

export const getAccountStateTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_account_state',
    description: 'Obtiene el saldo actual de la cuenta consolidado desde los brokers (Venues), el capital disponible y los desafíos/objetivos activos.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export async function executeGetAccountState() {
  const [alpacaBalance, bybitBalance, challenges] = await Promise.all([
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
  ]);

  const totalCash = (alpacaBalance?.cash ?? 0) + (bybitBalance?.cash ?? 0);

  return {
    consolidatedBalance: {
      totalCash,
      alpaca: alpacaBalance,
      bybit: bybitBalance,
    },
    challenges,
  };
}
