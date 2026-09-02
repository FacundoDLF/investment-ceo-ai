import { createChatCompletionWithRetry } from '@/shared/lib/groq';
import { executeOrder, getMarketPrice, getOptionsChain } from '@/features/venues/venue.service';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';
import { MissionService } from '../services/mission.service';
import { prisma } from '@/shared/lib/prisma';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import type { Position } from '@/shared/interfaces/venue.adapter';
import { cancelAllOrders, getUnifiedPositions } from '@/features/venues/venue.service';

let lastActionTime = 0;

let currentRotationIndex = 0; // State for multi-asset rotation

export async function runOctavioIteration(): Promise<boolean> {
  const config = StateService.getOctavioState();
  if (!config.active) return true;

  try {
    const currentPnL = await MissionService.getOctavioPnL();
    if (currentPnL >= config.target && config.target > 0) {
      if (config.autoResetPnL !== false) {
        console.log(`${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}✅ [Octavio] ¡SPRINT COMPLETADO (Alcancía Llena)! Meta de $${config.target} alcanzada (Total: $${currentPnL.toFixed(2)}). Reiniciando alcancía...${ANSI_COLORS.RESET}`);
        await MissionService.resetOctavioPnL();
        await MissionService.setOctavioReport(`¡SPRINT COMPLETADO! Superé la meta de $${config.target}. He consolidado $${currentPnL.toFixed(2)} de ganancias previas y he reiniciado mi alcancía a $0.`);
      }
    }

    const rawAsset = config.targetAsset;
    let baseCoins: string[] = [];
    
    if (rawAsset.includes(',')) {
      baseCoins = rawAsset.split(',').map(s => s.replace('USDT', '').replace('USDC', '').trim());
    } else {
      baseCoins = [rawAsset.replace('USDT', '').replace('USDC', '').trim()]; // ej. BTC
    }
    
    // Rotate to the next coin
    if (currentRotationIndex >= baseCoins.length) currentRotationIndex = 0;
    const baseCoin = baseCoins[currentRotationIndex];
    currentRotationIndex++; // Increment for next iteration
    
    // Obtener la cadena de opciones y posiciones en paralelo (I/O optimization)
    let optionsChain: any[] = [];
    let positions: any[] = [];
    try {
      [optionsChain, positions] = await Promise.all([
        getOptionsChain('bybit', baseCoin),
        getUnifiedPositions('bybit')
      ]);
    } catch (e: any) {
      console.warn(`[Octavio] Error de red: ${e.message}`);
      return true;
    }
    const myOptionsPositions = positions.filter((p: Position) => p.symbol.includes('-') && p.qty > 0 && p.symbol.startsWith(baseCoin));

    const now = Date.now();
    if (myOptionsPositions.length > 0) {
      console.log(`${LOG_PREFIX.OCTAVIO} Monitoreando ${myOptionsPositions.length} posiciones de Opciones activas.`);
      let forcedClose = false;
      for (const p of myOptionsPositions) {
        const isCall = p.symbol.endsWith('-C');
        const typeName = isCall ? 'CALL' : 'PUT';
        const pnlPct = p.unrealizedPlPc * 100;
        const pnlPctStr = pnlPct.toFixed(2);
        const color = pnlPct >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
        const sign = pnlPct > 0 ? '+' : '';
        console.log(`${LOG_PREFIX.OCTAVIO} Calculando recorrido de ${p.symbol} (${typeName}):`);
        console.log(`  ├─ Entrada : $${p.avgEntryPrice.toFixed(4)}`);
        console.log(`  ├─ Actual  : $${p.currentPrice.toFixed(4)}`);
        console.log(`  └─ Var %   : ${color}${sign}${pnlPctStr}%${ANSI_COLORS.RESET}`);

        // 🛡️ HARD STOP LOSS EN OPCIONES (-40%)
        if (pnlPct <= -40.0) {
           console.log(`\n======================================================`);
           console.log(`${ANSI_COLORS.RED}💀 [OCTAVIO HARD STOP LOSS] Theta Decay / Drawdown extremo (${pnlPctStr}%). ¡Liquidando ${p.symbol} por Damage Control!${ANSI_COLORS.RESET}`);
           console.log(`======================================================\n`);
           
           await executeOrder('bybit', {
             symbol: p.symbol,
             side: p.side === 'buy' ? 'sell' : 'buy',
             qty: p.qty,
             type: 'market',
             category: 'option',
             reduceOnly: true
           }).catch(() => {});
           
           const realizedPnl = p.unrealizedPl || 0;
           await MissionService.addOctavioPnL(realizedPnl);
           await MissionService.addLifetimeOctavioPnL(realizedPnl);
           
           await prisma.executionLog.create({
              data: { eventType: 'OPTION_TRADE_CLOSED', venue: 'bybit', symbol: p.symbol, success: true, details: JSON.stringify({ reason: 'HARD_STOP_LOSS', pnlPct, realizedPnl }) }
           });
           forcedClose = true;
        }
      }
      
      if (forcedClose) return false; // Bypass cooldown if forced close occurred

      const targetPct = (config.target / config.budget) * 100;
      const currentPct = (currentPnL / config.budget) * 100;
      console.log(`${ANSI_COLORS.CYAN}  [Resumen] Presupuesto: $${config.budget.toFixed(2)} | Alcancía: $${currentPnL.toFixed(2)} (${currentPct.toFixed(2)}%) | Target: $${config.target.toFixed(2)} (Tier ~${targetPct.toFixed(0)}%)${ANSI_COLORS.RESET}`);
    } // Cierra if (myOptionsPositions.length > 0)

    // Filtrar contratos inválidos/expirados y ordenar por liquidez
    const tradableChain = optionsChain
      .filter(opt => parseFloat(opt.bid1Price || '0') > 0 && parseFloat(opt.ask1Price || '0') > 0)
      .sort((a, b) => parseFloat(b.volume24h || '0') - parseFloat(a.volume24h || '0'));

    if (myOptionsPositions.length === 0 && tradableChain.length === 0) {
      console.log(`${LOG_PREFIX.OCTAVIO} Escaneando opciones de ${baseCoin}. Contratos disponibles: 0. Rotando...`);
      return false; // Bypass cooldown
    }

    if (myOptionsPositions.length === 0) {
      console.log(`${LOG_PREFIX.OCTAVIO} Escaneando opciones de ${baseCoin}. Contratos disponibles: ${optionsChain.length} (Filtrados Tradeables: ${tradableChain.length})`);
    }

    let directiveText = "";
    const ceoDirective = StateService.getOctavioDirective();
    if (ceoDirective) {
      console.log(`${ANSI_COLORS.YELLOW}[Octavio] ¡Grito del CEO recibido ("${ceoDirective}")!${ANSI_COLORS.RESET}`);
      directiveText = `\n\n⚠️ [DIRECTIVA URGENTE DEL CEO]: "${ceoDirective}"`;
      StateService.setOctavioDirective(null);
    }

    // Limitar la data que le enviamos al LLM para no volar el context window
    const filteredChain = tradableChain.slice(0, 10).map(opt => ({
      symbol: opt.symbol,
      bid: opt.bid1Price,
      ask: opt.ask1Price,
      iv: opt.markIv,
      delta: opt.delta,
      gamma: opt.gamma,
      vega: opt.vega,
      theta: opt.theta
    }));

    const systemPrompt = `Eres Octavio, un Trader Especialista en Opciones Crypto.
Operas en Bybit (categoría option). Presupuesto asignado: $${config.budget}.
Tu activo base es: ${baseCoin}.
Posiciones Abiertas: ${JSON.stringify(myOptionsPositions)}
Cadena de Opciones (Muestra parcial): ${JSON.stringify(filteredChain)}${directiveText}

Reglas Críticas:
1. Comprar opciones (Long Call / Long Put) requiere pagar la Prima (Premium). Theta decay comerá tu valor cada día.
2. Si ves alta Volatilidad Implícita (IV) injustificada, considera no comprar.
3. Si el PnL de una opción abierta supera tu target esperado o el Theta te está destruyendo, cierra la posición (CLOSE_OPTION).
4. No envíes texto, solo usa la tool 'options_action'.`;

    const optionsTool: ChatCompletionTool = {
      type: 'function',
      function: {
        name: 'options_action',
        description: 'Ejecuta una acción en el mercado de opciones',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['OPEN_OPTION', 'CLOSE_OPTION', 'HOLD'] },
            symbol: { type: 'string', description: 'El símbolo OCC del contrato (ej. BTC-29DEC23-35000-C)' },
            side: { type: 'string', enum: ['buy', 'sell'] },
            reason: { type: 'string', description: 'Justificación basada en griegas/volatilidad' }
          },
          required: ['action']
        }
      }
    };

    const response = await createChatCompletionWithRetry({
      role: 'EXECUTOR',
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [optionsTool],
      tool_choice: { type: 'function', function: { name: 'options_action' } }
    });

    const msg = response.choices[0]?.message;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0];
      if (tc.function.name === 'options_action') {
        const args = JSON.parse(tc.function.arguments);
        
        if (args.action === 'HOLD') {
          console.log(`${LOG_PREFIX.OCTAVIO} HOLD. Razón: ${args.reason || 'Esperando mejor oportunidad'}`);
          return false; // Bypass cooldown para rotar de moneda
        }

        if (now - lastActionTime < 10000) return true; // Cooldown 10s

        console.log(`\n======================================================`);
        console.log(`${ANSI_COLORS.CYAN}🧠 DECISIÓN ESTRATÉGICA OCTAVIO${ANSI_COLORS.RESET}`);
        console.log(`  ├─ Acción : ${args.action}`);
        console.log(`  ├─ Activo : ${args.symbol}`);
        console.log(`  └─ Razón  : ${args.reason}`);
        console.log(`======================================================\n`);

        try {
          // Validar existencia del contrato 1 ms antes de ejecutar y obtener reglas de lote
          console.log(`${LOG_PREFIX.OCTAVIO} Validando estado del contrato ${args.symbol} en el broker...`);
          let instrumentInfo;
          try {
            const m = await import('@/features/venues/venue.service');
            instrumentInfo = await m.getInstrumentInfo('bybit', args.symbol);
          } catch (validationErr: any) {
            console.log(`${ANSI_COLORS.YELLOW}⚠️ [Octavio] Contrato inválido o expirado en el Broker: ${validationErr.message}. Abortando orden.${ANSI_COLORS.RESET}`);
            return false; // Skip wait to rotate immediately
          }
          if (args.action === 'OPEN_OPTION') {
            const minQty = instrumentInfo?.minOrderQty || 0.1;
            
            console.log(`\n======================================================`);
            console.log(`${ANSI_COLORS.PINK}[OCTAVIO ATAQUE]${ANSI_COLORS.RESET} 🎯 ¡Entrando a ${args.symbol} (${args.side})!`);
            console.log(`======================================================\n`);
            
            await executeOrder('bybit', {
              symbol: args.symbol,
              side: args.side,
              qty: minQty, // Dinámico según las reglas de la moneda
              type: 'market',
              category: 'option'
            });
            
            await prisma.executionLog.create({
              data: { eventType: 'OPTION_TRADE_OPENED', venue: 'bybit', symbol: args.symbol, success: true, details: JSON.stringify({ side: args.side, reason: args.reason, qty: minQty }) }
            });
          } else if (args.action === 'CLOSE_OPTION') {
             const posToClose = myOptionsPositions.find(p => p.symbol === args.symbol);
             if (posToClose) {
               console.log(`\n======================================================`);
               console.log(`${ANSI_COLORS.GREEN}[OCTAVIO CERRANDO POSICIÓN]${ANSI_COLORS.RESET} 💰 Ejecutando Take Profit / Cierre estratégico en ${args.symbol}!`);
               console.log(`======================================================\n`);
               
               await executeOrder('bybit', {
                 symbol: args.symbol,
                 side: posToClose.side === 'buy' ? 'sell' : 'buy', // En opciones bybit, cerrar una posición es enviar orden contraria con reduceOnly
                 qty: posToClose.qty,
                 type: 'market',
                 category: 'option',
                 reduceOnly: true
               });
               
               const realizedPnl = posToClose.unrealizedPl || 0;
               await MissionService.addOctavioPnL(realizedPnl);
               await MissionService.addLifetimeOctavioPnL(realizedPnl);
               
               await prisma.executionLog.create({
                  data: { eventType: 'OPTION_TRADE_CLOSED', venue: 'bybit', symbol: args.symbol, success: true, details: JSON.stringify({ reason: args.reason, realizedPnl }) }
               });
             }
          }
          lastActionTime = now;
        } catch (e: any) {
          console.log(`${ANSI_COLORS.RED}❌ [Octavio Error] Falló la ejecución: ${e.message}${ANSI_COLORS.RESET}`);
        }
      }
    }

  } catch (error: any) {
    // Fail silently in loop
  }
  return true;
}
