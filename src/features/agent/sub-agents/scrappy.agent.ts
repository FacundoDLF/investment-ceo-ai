import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { executeOrder, getMarketPrice } from '@/features/venues/venue.service';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';
import { prisma } from '@/shared/lib/prisma';

// Estado en memoria de Scrappy
let currentScalpPosition: { symbol: string, side: 'buy' | 'sell', entryPrice: number, qty: number } | null = null;
let lastLogTime = 0;
let lastHeartbeatTime = 0;

export async function runScrappyIteration() {
  const config = StateService.getScrappyState();
  if (!config.active) return; // Apagado

  try {
    const symbol = config.targetAsset;
    const priceData = await getMarketPrice('bybit', symbol);
    const midPrice = (priceData.bid + priceData.ask) / 2;
    const spread = priceData.ask - priceData.bid;
    const spreadPct = (spread / midPrice) * 100;

    let pnlPct = 0;
    if (currentScalpPosition) {
      if (currentScalpPosition.symbol !== symbol) {
        // El CEO cambió de activo, deberíamos cerrar el actual (Liquidación forzada).
        currentScalpPosition = null; 
      } else {
        const exitPrice = currentScalpPosition.side === 'buy' ? priceData.bid : priceData.ask;
        pnlPct = currentScalpPosition.side === 'buy' 
          ? ((exitPrice - currentScalpPosition.entryPrice) / currentScalpPosition.entryPrice) * 100
          : ((currentScalpPosition.entryPrice - exitPrice) / currentScalpPosition.entryPrice) * 100;
        
        // Log "Anormal" (ganancia o pérdida notable > 0.5%)
        if (Math.abs(pnlPct) >= 0.5) {
          const now = Date.now();
          if (now - lastLogTime > 60000) { // No floodear si se queda colgado
            console.log(`\x1b[35m[Scrappy]\x1b[0m 🚨 RENTABILIDAD ANORMAL DETECTADA: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% en ${symbol}`);
            lastLogTime = now;
          }
        }
      }
    }

    const systemPrompt = `Eres Scrappy, un Scalp Trader HFT ultrarrápido.
Tu objetivo es acumular micro-ganancias. Operas en Bybit. Presupuesto asignado: $${config.budget}.
Tu estado actual:
- Posición abierta: ${currentScalpPosition ? `${currentScalpPosition.side.toUpperCase()} en ${currentScalpPosition.entryPrice}` : 'NINGUNA'}
- PnL Flotante: ${pnlPct.toFixed(3)}%
- Activo objetivo: ${symbol}
- Precio Actual: BID ${priceData.bid} / ASK ${priceData.ask} / SPREAD ${spreadPct.toFixed(4)}%

Reglas Críticas:
1. Si no tienes posición y el spread es bajo, puedes ABRIR (buy o sell) si ves oportunidad (usa tu intuición rápida).
2. Si tienes posición y el PnL es > 0.15% (profit), CIERRA inmediatamente para asegurar ganancia.
3. Si el PnL es < -0.3% (loss), CIERRA inmediatamente (Stop Loss estricto).
4. No envíes explicaciones largas. Responde SÓLO ejecutando la herramienta 'scalp_action'.`;

    const scalpTool: ChatCompletionTool = {
      type: 'function',
      function: {
        name: 'scalp_action',
        description: 'Ejecuta una acción inmediata de scalping',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_POSITION', 'HOLD', 'WAIT'] },
          },
          required: ['action']
        }
      }
    };

    const response = await createChatCompletionWithRetry({
      model: 'meta-llama/llama-3.3-70b-instruct',
      fallbackModels: [
        'qwen/qwen-2.5-72b-instruct',
        'meta-llama/llama-3.3-70b-instruct:free',
        'nvidia/llama-3.1-nemotron-70b-instruct:free',
        'qwen/qwen-2-72b-instruct:free'
      ],
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [scalpTool],
      tool_choice: 'auto'
    });

    const msg = response.choices[0]?.message;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      if (tc.function.name === 'scalp_action') {
        const args = JSON.parse(tc.function.arguments);
        const action = args.action;

        // Logging visual amigable
        if (action === 'OPEN_LONG' || action === 'OPEN_SHORT') {
           console.log(`\x1b[35m[Scrappy]\x1b[0m ⚡ Abriendo posición ${action === 'OPEN_LONG' ? 'LONG' : 'SHORT'} rápida en ${symbol} (Precio: $${midPrice.toFixed(2)})`);
        } else if (action === 'CLOSE_POSITION') {
           console.log(`\x1b[35m[Scrappy]\x1b[0m 💥 Cerrando posición en ${symbol} (PnL estimado: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
        } else {
           const now = Date.now();
           // Latido cada 30 segundos si está inactivo o holdeando
           if (now - lastHeartbeatTime > 30000) {
              if (currentScalpPosition) {
                 console.log(`\x1b[35m[Scrappy]\x1b[0m 👀 Manteniendo ${currentScalpPosition.side.toUpperCase()} en ${symbol} | PnL actual: ${pnlPct > 0 ? '\x1b[32m+' : '\x1b[31m'}${pnlPct.toFixed(3)}%\x1b[0m`);
              } else {
                 console.log(`\x1b[35m[Scrappy]\x1b[0m ⏳ Buscando oportunidad de scalping en ${symbol}... (Spread: ${spreadPct.toFixed(4)}%)`);
              }
              lastHeartbeatTime = now;
           }
        }

        await executeScalpAction(action, symbol, config.budget, midPrice, pnlPct);
      }
    }

  } catch (error: any) {
    // Silencioso. En scalping, si hay timeout de red, lo intentamos al siguiente segundo.
  }
}

async function executeScalpAction(action: string, symbol: string, budget: number, currentPrice: number, pnlPct: number) {
  try {
    if (action === 'HOLD' || action === 'WAIT') return;

    if (action === 'CLOSE_POSITION' && currentScalpPosition) {
      // Mandar orden de cierre real
      await executeOrder('bybit', {
        symbol: symbol,
        side: currentScalpPosition.side === 'buy' ? 'sell' : 'buy',
        qty: currentScalpPosition.qty,
        type: 'market',
        category: 'linear'
      }).catch(() => {}); // Ignorar errores de red para no frenar

      // Imprimir log solo si la ganancia/pérdida es anormal (> 0.5%)
      if (Math.abs(pnlPct) >= 0.5) {
        console.log(`\x1b[35m[Scrappy]\x1b[0m 💰 Posición CERRADA en ${symbol}. Rendimiento final: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
        // Registrar en DB para el historial
        await prisma.executionLog.create({
          data: {
            eventType: 'SCALP_TRADE_CLOSED',
            venue: 'bybit',
            symbol,
            success: true,
            details: JSON.stringify({ pnlPct })
          }
        });
      }
      currentScalpPosition = null;
      return;
    }

    if ((action === 'OPEN_LONG' || action === 'OPEN_SHORT') && !currentScalpPosition) {
      // Calcular cantidad de monedas según presupuesto
      let qty = budget / currentPrice;
      
      // Normalizar qty para Bybit
      if (symbol === 'BTCUSDT') {
        qty = Math.floor(qty * 100000) / 100000;
      } else if (symbol === 'ETHUSDT') {
        qty = Math.floor(qty * 10000) / 10000;
      } else {
        qty = Math.floor(qty * 100) / 100;
      }

      if (qty <= 0) return;

      const side = action === 'OPEN_LONG' ? 'buy' : 'sell';

      await executeOrder('bybit', {
        symbol: symbol,
        side: side,
        qty: qty,
        type: 'market',
        category: 'linear'
      }).catch(() => {}); // Fallo silencioso

      currentScalpPosition = {
        symbol,
        side,
        entryPrice: currentPrice,
        qty
      };
    }
  } catch (e) {
    // Fail silently in HFT loop
  }
}
