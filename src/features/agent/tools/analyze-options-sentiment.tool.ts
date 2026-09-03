import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { getOptionsChain } from '@/features/venues/venue.service';

export const analyzeOptionsSentimentSchema = z.object({
  asset: z.string().describe('Símbolo base del activo a analizar (ej. BTC, SPX)'),
  venue: z.enum(['alpaca', 'bybit']).describe('El broker correspondiente (alpaca para SPX/VIX, bybit para BTC/ETH)')
});

export const analyzeOptionsSentimentTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'analyze_options_sentiment',
    description: 'Analiza la cadena de opciones de un activo para obtener el sentimiento institucional del mercado (Put/Call Ratio y Volatilidad Implícita).',
    parameters: {
      type: 'object',
      properties: {
        asset: { type: 'string' },
        venue: { type: 'string', enum: ['alpaca', 'bybit'] }
      },
      required: ['asset', 'venue'],
    },
  },
};

export async function executeAnalyzeOptionsSentiment(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    const result = analyzeOptionsSentimentSchema.safeParse(parsedArgs);
    
    if (!result.success) {
      return { error: "Validation Error", details: result.error.issues };
    }
    
    const { asset, venue } = result.data;

    const baseCoin = asset.replace('USDT', '').replace('USDC', '').trim();
    const chain = await getOptionsChain(venue as 'alpaca' | 'bybit', baseCoin);

    if (!chain || chain.length === 0) {
      return { error: `No options chain found for ${baseCoin} in ${venue}.` };
    }

    let callVolume = 0;
    let putVolume = 0;
    let totalIv = 0;
    let ivCount = 0;

    for (const opt of chain) {
      const vol = parseFloat(opt.volume24h || '0');
      
      const isCall = opt.type === 'call' || opt.symbol.endsWith('-C');
      const isPut = opt.type === 'put' || opt.symbol.endsWith('-P');

      if (isCall && !isNaN(vol)) callVolume += vol;
      if (isPut && !isNaN(vol)) putVolume += vol;

      const iv = parseFloat(opt.markIv || '0');
      if (!isNaN(iv) && iv > 0) {
        // Bybit usually returns IV as a decimal (e.g. 0.5 for 50%). Alpaca beta might return raw or decimal.
        totalIv += iv;
        ivCount++;
      }
    }

    const pcr = callVolume > 0 ? (putVolume / callVolume) : 0;
    const avgIv = ivCount > 0 ? (totalIv / ivCount) : 0;

    let sentiment = 'Neutral';
    if (pcr > 1.2) {
      sentiment = 'Extreme Fear (Bearish)';
    } else if (pcr > 0.9) {
      sentiment = 'Fear (Bearish Bias)';
    } else if (pcr < 0.6) {
      sentiment = 'Extreme Greed (Bullish)';
    } else if (pcr < 0.8) {
      sentiment = 'Greed (Bullish Bias)';
    }

    // Si el volumen de opciones es cero (fin de semana o fuera de horario)
    if (callVolume === 0 && putVolume === 0) {
      sentiment = 'Unknown (Zero Volume)';
    }

    return {
      asset: baseCoin,
      metrics: {
        totalCallVolume: callVolume,
        totalPutVolume: putVolume,
        putCallRatio: parseFloat(pcr.toFixed(4)),
        averageImpliedVolatility: parseFloat(avgIv.toFixed(4))
      },
      institutionalSentiment: sentiment,
      insight: `A Put/Call ratio of ${pcr.toFixed(2)} indicates that for every 100 Call contracts traded, there are ${(pcr * 100).toFixed(0)} Put contracts traded. ${sentiment}`
    };

  } catch (error: any) {
    console.error('[Options Sentiment Error]', error.message);
    return { error: error.message };
  }
}
