import { prisma } from '@/shared/lib/prisma';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';

export const getAccountStateTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_account_state',
    description: 'Obtiene el saldo actual de la cuenta, el capital disponible y los desafíos/objetivos activos.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export async function executeGetAccountState() {
  const [account, challenges] = await Promise.all([
    prisma.account.findFirst({
      select: {
        balance: true,
      },
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

  return {
    balance: account?.balance ?? 0,
    challenges, // Ya está filtrado solo con title y targetMetric gracias a Prisma select
  };
}
