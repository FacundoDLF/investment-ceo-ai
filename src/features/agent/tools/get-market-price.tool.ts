import { z } from 'zod';
import { getMarketPrice, VenueName } from '../../venues/venue.service';

import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';

export const getMarketPriceTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_market_price',
    description: 'Fetches real-time Bid and Ask prices directly from the broker (Venue) for a specific symbol. THIS IS THE ONLY SOURCE OF TRUTH FOR PRICES.',
    parameters: {
      type: 'object',
      properties: {
        venue: {
          type: 'string',
          enum: ['alpaca', 'bybit'],
          description: 'The trading venue to fetch the price from.',
        },
        symbol: {
          type: 'string',
          description: 'The ticker symbol (e.g., AAPL for Alpaca, BTCUSDT for Bybit).',
        }
      },
      required: ['venue', 'symbol'],
    },
  },
};

export async function executeGetMarketPrice(argsString: string): Promise<any> {
  try {
    const args = JSON.parse(argsString);
    if (!args.venue || !args.symbol) {
      throw new Error("Missing required arguments: venue and symbol");
    }
    
    const price = await getMarketPrice(args.venue as VenueName, args.symbol);
    
    return {
      success: true,
      venue: args.venue,
      symbol: args.symbol,
      bid: price.bid,
      ask: price.ask,
      fundingRate: price.fundingRate,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(`[Tool] Error obteniendo precio: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
