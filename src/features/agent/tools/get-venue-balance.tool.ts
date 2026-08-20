import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getUnifiedBalance } from '@/features/venues/venue.service';

export const GetVenueBalanceSchema = z.object({
  venue: z.enum(['alpaca', 'bybit']).describe("El nombre del broker/venue ('alpaca' o 'bybit')")
});

export type GetVenueBalanceArgs = z.infer<typeof GetVenueBalanceSchema>;

export const getVenueBalanceTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_venue_balance',
    description: 'Obtiene el saldo disponible en cualquiera de nuestros brokers conectados (Venues).',
    parameters: {
      type: 'object',
      properties: {
        venue: {
          type: 'string',
          enum: ['alpaca', 'bybit'],
          description: "El nombre del broker/venue ('alpaca' o 'bybit')"
        }
      },
      required: ['venue']
    }
  }
};

export async function executeGetVenueBalance(argsStr: string) {
  const parsed = JSON.parse(argsStr);
  const args = GetVenueBalanceSchema.parse(parsed);

  const balanceBreakdown = await getUnifiedBalance(args.venue);
  return {
    venue: args.venue,
    ...balanceBreakdown
  };
}
