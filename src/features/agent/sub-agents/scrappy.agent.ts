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

// Trailing Stop State
let trailingMaxPnl = 0;
let trailingActive = false;
let trailingDistance = 0.20;

export async function runScrappyIteration() {
  const config = StateService.getScrappyState();
  if (!config.active) return; // Apagado

  try {
    // 🛡️ REVISIÓN PROACTIVA DE ALCANCÍA (Por si el CEO bajó la meta abruptamente)
    const currentPnL = await MissionService.getScrappyPnL();
    if (currentPnL >= config.target && config.target > 0) {
      if (config.autoResetPnL !== false) {
        console.log(`${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}✅ [Scrappy] ¡SPRINT COMPLETADO (Alcancía Llena)! Meta de $${config.target} alcanzada pasivamente (Total: $${currentPnL.toFixed(2)}). Reiniciando alcancía...${ANSI_COLORS.RESET}`);
        await MissionService.resetScrappyPnL();
        await MissionService.setScrappyReport(`¡SPRINT COMPLETADO! Se re-evaluó la alcancía y superó la meta de $${config.target}. He consolidado $${currentPnL.toFixed(2)} de ganancias previas y he reiniciado mi alcancía a $0. Sigo operando con normalidad.`);
      }
    }

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

      // 🛡️ ALGORITMO DE TRAILING STOP (Cero Latencia, antes del LLM)
      if (pnlPct > trailingMaxPnl) {
        trailingMaxPnl = pnlPct; // Actualizar High Water Mark
      }
      
      if (trailingActive && (trailingMaxPnl - pnlPct >= trailingDistance)) {
        console.log(`${ANSI_COLORS.GREEN}🔥 [TRAILING STOP EXECUTED] Retroceso detectado de ${trailingDistance}%. ¡Tomando Ganancias Inmediatamente! (Max: +${trailingMaxPnl.toFixed(2)}%, Actual: +${pnlPct.toFixed(2)}%)${ANSI_COLORS.RESET}`);
        trailingActive = false; // Apagar trailing hasta próxima decisión
        trailingMaxPnl = 0;     // Resetear marca de agua
        await executeScalpAction('CLOSE_POSITION', symbol, config, priceData, myPosition, pnlPct, true);
        return; // Detener iteración para no invocar al LLM
      }

      const now = Date.now();
      if (now - lastLogTime > 30000) { // Logging táctico cada 30s
        if (trailingActive) {
           console.log(`${ANSI_COLORS.CYAN}🏃‍♂️ [Scrappy] Modo Trailing Activo. Persiguiendo precio. Max: +${trailingMaxPnl.toFixed(2)}% | Actual: +${pnlPct.toFixed(2)}% (Gatillo si baja a +${(trailingMaxPnl - trailingDistance).toFixed(2)}%)${ANSI_COLORS.RESET}`);
           lastLogTime = now;
        } else if (pnlPct >= 0.50 && pnlPct < 0.80) {
          console.log(`${ANSI_COLORS.GREEN}🟢 [Scrappy Radar] Zona de Tolerancia alcanzada (+${pnlPct.toFixed(2)}%). Evaluando Take Profit o Trailing Stop...${ANSI_COLORS.RESET}`);
          lastLogTime = now;
        } else if (pnlPct <= -1.00 && pnlPct > -1.50) {
          console.log(`${ANSI_COLORS.RED}🔴 [Scrappy Radar] Drawdown profundo detectado (${pnlPct.toFixed(2)}%). Acercándose a zona DCA (-1.50%)...${ANSI_COLORS.RESET}`);
          lastLogTime = now;
        } else if (Math.abs(pnlPct) >= 1.50) {
          console.log(`${ANSI_COLORS.PINK}[Scrappy] ⚠️ RENTABILIDAD CRÍTICA DETECTADA: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% en ${symbol}${ANSI_COLORS.RESET}`);
          lastLogTime = now;
        }
      }
    } else {
      // No tenemos posición. Resetear estado de trailing y limpiar órdenes
      trailingActive = false;
      trailingMaxPnl = 0;
      await cancelAllOrders('bybit', symbol, 'linear').catch(() => { });
    }

    let directiveText = "";
    const ceoDirective = StateService.getScrappyDirective();
    if (ceoDirective) {
      console.log(`${ANSI_COLORS.YELLOW}[Scrappy] ¡Grito del CEO recibido ("${ceoDirective}")! Inyectando orden de emergencia en el motor HFT...${ANSI_COLORS.RESET}`);
      directiveText = `\n\n⚠️ [DIRECTIVA URGENTE DEL CEO]: "${ceoDirective}"\n¡DEBES OBEDECER ESTA INSTRUCCIÓN INMEDIATAMENTE EN TU PRÓXIMA ACCIÓN!`;
      StateService.setScrappyDirective(null); // Consumir el mensaje
    }

    const systemPrompt = `Eres Scrappy, un Scalp Trader HFT ultrarrápido.
Tu objetivo es acumular micro-ganancias. Operas en Bybit. Presupuesto asignado: $${config.budget}.
Tu estado actual:
- Posición abierta: ${myPosition ? `${myPosition.side?.toUpperCase() || 'ACTIVA'} en ${myPosition.avgEntryPrice}` : 'NINGUNA'}
- PnL Flotante: ${pnlPct.toFixed(3)}%
- Activo objetivo: ${symbol}
- Precio Actual: BID ${priceData.bid} / ASK ${priceData.ask} / SPREAD ${spreadPct.toFixed(4)}%${directiveText}

Reglas Críticas:
1. Si no tienes posición y el spread es bajo, puedes ABRIR (buy o sell) si ves oportunidad.
2. Si tienes posición y el PnL Flotante Bruto es >= +0.80% (profit óptimo), DECIDE: 
   - Si el mercado pierde fuerza, usa CLOSE_POSITION para asegurar ganancias ahora mismo.
   - Si el mercado tiene fuerte impulso, usa ACTIVATE_TRAILING (con distance=0.20) para perseguir el precio hacia arriba.
3. Si el PnL Flotante Bruto es <= -1.50% (loss profundo), AÑADE a la posición (DCA: OPEN_LONG si estabas en long) para promediar a la baja. Dale espacio al precio para respirar antes de intervenir. No cierres en pérdida.
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
            action: { type: 'string', enum: ['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_POSITION', 'ACTIVATE_TRAILING', 'HOLD', 'WAIT'] },
            distance: { type: 'number', description: 'Porcentaje de retroceso para el Trailing Stop (ej. 0.20)' }
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

        if (action === 'ACTIVATE_TRAILING') {
          const dist = args.distance && args.distance >= 0.20 ? args.distance : 0.20;
          trailingActive = true;
          trailingDistance = dist;
          trailingMaxPnl = pnlPct;
          console.log(`${ANSI_COLORS.CYAN}[Scrappy] ¡Trailing Stop Activado por la IA! Persiguiendo precio con distancia de ${dist}%.${ANSI_COLORS.RESET}`);
          return;
        }

        // Heartbeat Logging
        if (action === 'HOLD' || action === 'WAIT') {
          const now = Date.now();
          if (now - lastHeartbeatTime > 30000) {
            if (myPosition) {
              console.log(`${ANSI_COLORS.PINK}[Scrappy]${ANSI_COLORS.RESET} Calculando recorrido del ${symbol} (${myPosition.side?.toUpperCase()}):`);
              console.log(`${ANSI_COLORS.GRAY}  ├─ Entrada : $${myPosition.avgEntryPrice}${ANSI_COLORS.RESET}`);
              console.log(`${ANSI_COLORS.GRAY}  ├─ Actual  : $${priceData.bid.toFixed(6)}${ANSI_COLORS.RESET}`);
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
  pnlPct: number,
  isTrailingExecution: boolean = false
) {
  try {
    if (action === 'HOLD' || action === 'WAIT') return;

    if (action === 'CLOSE_POSITION' && myPosition) {
      // 🛡️ SALVAGUARDA MATEMÁTICA: Prohibido Take Profit prematuro (salvo que sea un Trailing Stop)
      if (!isTrailingExecution && pnlPct >= 0 && pnlPct < 0.50) {
        return; // Anular orden silenciosamente
      }
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
        console.log(`${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}✅ [Scrappy] ¡SPRINT COMPLETADO! Meta de $${config.target} alcanzada (Total: $${accumulatedPnL.toFixed(2)}). Transfiriendo fondos y reiniciando cacería...${ANSI_COLORS.RESET}`);
        await MissionService.resetScrappyPnL();
        await MissionService.setScrappyReport(`¡SPRINT COMPLETADO! Se alcanzó la meta de $${config.target}. He consolidado $${accumulatedPnL.toFixed(2)} de ganancias en el balance del Exchange y he reiniciado un nuevo sprint con el mismo presupuesto. Sigo operando activamente a la espera de nuevas órdenes si lo deseas.`);
      }

      if (Math.abs(pnlPct) >= 0.5) {
        const msgColor = pnlPct > 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.WHITE;
        console.log(`${LOG_PREFIX.SCRAPPY} ${msgColor}Posición CERRADA en ${symbol}. Rendimiento final: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${realizedPnl.toFixed(2)})${ANSI_COLORS.RESET}`);
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

      // 🛡️ SALVAGUARDA MATEMÁTICA: Prohibido DCA prematuro
      if (myPosition && pnlPct > -1.50) {
        return; // Anular orden silenciosamente
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

      const orderValue = qty * currentPrice;
      if (qty <= 0 || orderValue < 5) {
        const now = Date.now();
        if (now - lastHeartbeatTime > 30000) {
          console.log(`${ANSI_COLORS.RED}❌ [Scrappy] Presupuesto insuficiente ($${config.budget.toFixed(2)}). El valor de la orden ($${orderValue.toFixed(2)}) no cumple con el mínimo de 5 USDT en Bybit para ${symbol}.${ANSI_COLORS.RESET}`);
          lastHeartbeatTime = now;
        }
        return;
      }

      const side = action === 'OPEN_LONG' ? 'buy' : 'sell';
      const sideStr = action === 'OPEN_LONG' ? 'LONG' : 'SHORT';
      const pnlColor = pnlPct >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
      const sign = pnlPct > 0 ? '+' : '';

      if (myPosition) {
        // DCA (Dollar Cost Averaging)
        console.log(`${ANSI_COLORS.MAGENTA}[Scrappy]${ANSI_COLORS.RESET} 📉 ¡Promediando a la baja (DCA)! Comprando más ${symbol} a $${currentPrice.toFixed(2)} (PnL Actual: ${pnlColor}${sign}${pnlPct.toFixed(2)}%${ANSI_COLORS.RESET})`);
        await cancelAllOrders('bybit', symbol, 'linear').catch(() => { }); // Limpiar TPs antiguos
      } else {
        console.log(`${ANSI_COLORS.PINK}[Scrappy]${ANSI_COLORS.RESET} ¡Grrr! Atacó con un ${sideStr} en ${symbol} a $${currentPrice.toFixed(2)} (Entrada Inicial)`);
      }

      // 🛡️ HFT: Zero Slippage & Maker Fees. Entramos con Limit Post-Only.
      // Si compramos (LONG), nos ponemos en el BID. Si vendemos (SHORT), nos ponemos en el ASK.
      const limitPrice = action === 'OPEN_LONG' ? priceData.bid : priceData.ask;

      await executeOrder('bybit', {
        symbol: symbol,
        side: side,
        qty: qty,
        type: 'limit',
        limitPrice: limitPrice,
        category: 'linear',
        postOnly: true
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
