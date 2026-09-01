import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getOptionsChain, VenueName } from '@/features/venues/venue.service';

export const getOptionsChainSchema = z.object({
  venue: z.string().describe('Broker a consultar: "bybit" o "alpaca"'),
  baseCoin: z.string().describe('Símbolo base para buscar opciones (ej. "BTC" en Bybit, "SPY" en Alpaca)')
});

export const getOptionsChainTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_options_chain',
    description: 'Consulta los contratos de opciones disponibles (Calls/Puts) para un activo base, con sus strikes y griegas (si aplica). Útil antes de operar opciones.',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', description: '"bybit" o "alpaca"' },
        baseCoin: { type: 'string', description: '"BTC", "ETH" (Bybit) o "SPY", "AAPL" (Alpaca)' }
      },
      required: ['venue', 'baseCoin'],
    },
  },
};

export async function executeGetOptionsChain(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const result = getOptionsChainSchema.safeParse(parsedArgs);
    
    if (!result.success) {
      return JSON.stringify({ error: "Validation Error", details: result.error.issues });
    }
    
    const { venue, baseCoin } = result.data;
    const chain = await getOptionsChain(venue as VenueName, baseCoin);
    
    // Limitar la respuesta a los 10 primeros contratos para no desbordar el contexto del LLM
    const summary = chain.slice(0, 10).map((opt: any) => {
      if (venue === 'bybit') {
        return {
          symbol: opt.symbol,
          bid: opt.bid1Price,
          ask: opt.ask1Price,
          iv: opt.markIv,
          delta: opt.delta,
          gamma: opt.gamma
        };
      } else {
        // Formato Alpaca
        return {
          symbol: opt.symbol,
          strike_price: opt.strike_price,
          type: opt.type,
          expiration_date: opt.expiration_date,
          open_interest: opt.open_interest || 'N/A'
        };
      }
    });

    return JSON.stringify({
      totalContractsFound: chain.length,
      sampleContracts: summary,
      note: 'Se muestran solo los primeros 10 contratos por límites de contexto. Usa un strike/symbol específico para operar.'
    });

  } catch (error: any) {
    console.error('Error en get_options_chain:', error);
    return JSON.stringify({ error: error.message });
  }
}
