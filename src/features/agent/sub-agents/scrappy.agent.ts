import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { executeOrder, getMarketPrice, getInstrumentInfo } from '@/features/venues/venue.service';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';
import { MissionService } from '../services/mission.service';
import { prisma } from '@/shared/lib/prisma';

import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';

import type { Position } from '@/shared/interfaces/venue.adapter';
import { cancelAllOrders, getUnifiedPositions } from '@/features/venues/venue.service';

let lastLogTime = 0;
let lastHeartbeatTime = 0;
let lastActionTime = 0;

export async function runScrappyIteration() {
  const config = StateService.getScrappyState();
  if (!config.active) return; // Apagado

  try {
    const symbol = config.targetAsset;
    const priceData = await getMarketPrice('bybit', symbol);
    const midPrice = (priceData.bid + priceData.ask) / 2;
    const spread = priceData.ask - priceData.bid;
    const spreadPct = (spread / midPrice) * 100;

    // 1. Obtener estado real del broker (STATELESS)
    const positions = await getUnifiedPositions('bybit');
    const myPosition = positions.find((p: Position) => p.symbol === symbol && p.qty > 0);

    let pnlPct = 0;
    if (myPosition) {
      // Bybit linear positions tienen side, si no lo inferimos del PnL
      pnlPct = myPosition.unrealizedPlPc * 100;

      // Log "Anormal" (ganancia o pérdida notable > 0.5%)
      if (Math.abs(pnlPct) >= 0.5) {
        const now = Date.now();
        if (now - lastLogTime > 60000) { // No floodear
          console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} 🚨 RENTABILIDAD ANORMAL DETECTADA: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% en ${symbol}`);
          lastLogTime = now;
        }
      }
    } else {
      // No tenemos posición. Limpiamos cualquier orden Límite huérfana
      await cancelAllOrders('bybit', symbol, 'linear').catch(() => { });
    }

    const systemPrompt = `Eres Scrappy, un Scalp Trader HFT ultrarrápido.
Tu objetivo es acumular micro-ganancias. Operas en Bybit. Presupuesto asignado: $${config.budget}.
Tu estado actual:
- Posición abierta: ${myPosition ? `${myPosition.side?.toUpperCase() || 'ACTIVA'} en ${myPosition.avgEntryPrice}` : 'NINGUNA'}
- PnL Flotante: ${pnlPct.toFixed(3)}%
- Activo objetivo: ${symbol}
- Precio Actual: BID ${priceData.bid} / ASK ${priceData.ask} / SPREAD ${spreadPct.toFixed(4)}%

Reglas Críticas:
1. Si no tienes posición y el spread es bajo, puedes ABRIR (buy o sell) si ves oportunidad.
2. Si tienes posición y el PnL Flotante Bruto es >= +0.15% (profit), CIERRA inmediatamente. Esto asegura cubrir el ~0.10% de comisiones del exchange y dejar un neto positivo.
3. Si el PnL Flotante Bruto es <= -0.50% (loss), AÑADE a la posición (DCA: OPEN_LONG si estabas en long) para promediar a la baja. No cierres en pérdida, ¡promedia!
4. NO PIENSES. NO RAZONES. NO EXPLIQUES NADA.
5. Tu ÚNICA salida permitida es invocar la herramienta 'scalp_action' INMEDIATAMENTE. No escribas texto antes ni después.`;

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
      role: 'EXECUTOR',
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [scalpTool],
      tool_choice: { type: 'function', function: { name: 'scalp_action' } }
    });

    const msg = response.choices[0]?.message;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      if (tc.function.name === 'scalp_action') {
        const args = JSON.parse(tc.function.arguments);
        const action = args.action;

        // Logging
        // Heartbeat Logging
        if (action === 'HOLD' || action === 'WAIT') {
          const now = Date.now();
          if (now - lastHeartbeatTime > 30000) {
            if (myPosition) {
              console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} 🐺 Calculando recorrido del ${symbol} (${myPosition.side?.toUpperCase()}):`);
              console.log(`${ANSI_COLORS.GRAY}  ├─ Entrada : $${myPosition.avgEntryPrice}${ANSI_COLORS.RESET}`);
              console.log(`${ANSI_COLORS.GRAY}  ├─ Actual  : $${priceData.bid.toFixed(2)}${ANSI_COLORS.RESET}`);
              console.log(`${ANSI_COLORS.GRAY}  └─ Var %     : ${pnlPct >= 0 ? ANSI_COLORS.GREEN + '+' : ANSI_COLORS.RED}${pnlPct.toFixed(3)}%${ANSI_COLORS.RESET}`);
            } else {
              console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} 🐕 Rastreando ${symbol}... (Spread: ${spreadPct.toFixed(4)}%)`);
            }
            lastHeartbeatTime = now;
          }
        }

        await executeScalpAction(action, symbol, config, priceData, myPosition, pnlPct);
      }
    }

  } catch (error: any) {
    // Fail silently in loop
  }
}

async function executeScalpAction(
  action: string,
  symbol: string,
  config: any,
  priceData: { bid: number, ask: number },
  myPosition: Position | undefined,
  pnlPct: number
) {
  try {
    if (action === 'HOLD' || action === 'WAIT') return;

    if (action === 'CLOSE_POSITION' && myPosition) {
      if (pnlPct >= 0) {
        // TAKE PROFIT: LIMIT POST-ONLY MAKER ORDER
        const limitPrice = myPosition.side === 'buy' ? priceData.ask : priceData.bid;

        await executeOrder('bybit', {
          symbol: symbol,
          side: myPosition.side === 'buy' ? 'sell' : 'buy',
          qty: myPosition.qty,
          type: 'limit',
          limitPrice: limitPrice,
          category: 'linear',
          postOnly: true,
          reduceOnly: true
        }).catch((e) => {
          console.log(`${LOG_PREFIX.SCRAPPY} ${ANSI_COLORS.RED}Error Take Profit: ${e.message}${ANSI_COLORS.RESET}`);
        });

      } else {
        // En teoría, el DCA evitará que entremos aquí a menos que el LLM se asuste.
        // Pero si decide cerrar en pérdida, usamos Taker.
        await cancelAllOrders('bybit', symbol, 'linear').catch(() => { });

        await executeOrder('bybit', {
          symbol: symbol,
          side: myPosition.side === 'buy' ? 'sell' : 'buy',
          qty: myPosition.qty,
          type: 'market',
          category: 'linear',
          reduceOnly: true
        }).catch(() => { });
      }

      const realizedPnl = myPosition.unrealizedPl || 0;
      const accumulatedPnL = await MissionService.addScrappyPnL(realizedPnl);
      await MissionService.addLifetimeScrappyPnL(realizedPnl);

      if (accumulatedPnL >= config.target) {
        console.log(`${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}🎉 [Scrappy] ¡SPRINT COMPLETADO! Meta de $${config.target} alcanzada (Total: $${accumulatedPnL.toFixed(2)}). Transfiriendo fondos y reiniciando cacería...${ANSI_COLORS.RESET}`);
        await MissionService.resetScrappyPnL();
        await MissionService.setScrappyReport(`¡SPRINT COMPLETADO! Se alcanzó la meta de $${config.target}. He consolidado $${accumulatedPnL.toFixed(2)} de ganancias en el balance del Exchange y he reiniciado un nuevo sprint con el mismo presupuesto. Sigo operando activamente a la espera de nuevas órdenes si lo deseas.`);
      }

      if (Math.abs(pnlPct) >= 0.5) {
        const msgColor = pnlPct > 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.WHITE;
        console.log(`${LOG_PREFIX.SCRAPPY} ${msgColor}💰 Posición CERRADA en ${symbol}. Rendimiento final: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${realizedPnl.toFixed(2)})${ANSI_COLORS.RESET}`);
        await prisma.executionLog.create({
          data: { eventType: 'SCALP_TRADE_CLOSED', venue: 'bybit', symbol, success: true, details: JSON.stringify({ pnlPct, realizedPnl }) }
        });
      }
      return;
    }

    if (action === 'OPEN_LONG' || action === 'OPEN_SHORT') {
      const now = Date.now();
      if (now - lastActionTime < 5000) {
        return; // Cooldown de 5 segundos para evitar spam
      }

      const currentPrice = action === 'OPEN_LONG' ? priceData.ask : priceData.bid;
      let qty = config.budget / currentPrice;

      try {
        const info = await getInstrumentInfo('bybit', symbol);
        // Calculate precision to avoid float math errors like 0.12900000000000003
        const precision = info.qtyStep.toString().split('.')[1]?.length || 0;
        qty = Number((Math.floor(qty / info.qtyStep) * info.qtyStep).toFixed(precision));
      } catch (e: any) {
        console.log(`${LOG_PREFIX.SCRAPPY} ${ANSI_COLORS.RED}Error obteniendo info del instrumento: ${e.message}${ANSI_COLORS.RESET}`);
        // Fallback genérico por si falla la API
        if (symbol === 'BTCUSDT') {
          qty = Math.floor(qty * 1000) / 1000;
        } else if (symbol === 'ETHUSDT') {
          qty = Math.floor(qty * 100) / 100;
        } else {
          qty = Math.floor(qty); // Asumimos enteros para el resto en fallback
        }
      }

      if (qty <= 0) return;

      const side = action === 'OPEN_LONG' ? 'buy' : 'sell';
      const sideStr = action === 'OPEN_LONG' ? 'LONG' : 'SHORT';
      const pnlColor = pnlPct >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
      const sign = pnlPct > 0 ? '+' : '';

      if (myPosition) {
        // DCA (Dollar Cost Averaging)
        console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} 📉 ¡Promediando a la baja (DCA)! Comprando más ${symbol} a $${currentPrice.toFixed(2)} (PnL Actual: ${pnlColor}${sign}${pnlPct.toFixed(2)}%${ANSI_COLORS.RESET})`);
        await cancelAllOrders('bybit', symbol, 'linear').catch(() => { }); // Limpiar TPs antiguos
      } else {
        console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} ⚡ ¡Grrr! Atacó con un ${sideStr} en ${symbol} a $${currentPrice.toFixed(2)} (Entrada Inicial)`);
      }

      await executeOrder('bybit', {
        symbol: symbol,
        side: side,
        qty: qty,
        type: 'market',
        category: 'linear'
      }).catch((e) => { 
        console.log(`${LOG_PREFIX.SCRAPPY} ${ANSI_COLORS.RED}Error abriendo posición: ${e.message}${ANSI_COLORS.RESET}`);
      });

      lastActionTime = now;
    }
  } catch (e: any) {
    // Fail silently in HFT loop unless it's a critical error
    // console.log("HFT Error:", e.message);
  }
}
