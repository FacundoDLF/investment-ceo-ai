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

export async function runOctavioIteration() {
  const config = StateService.getOctavioState();
  if (!config.active) return;

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
    
    // Obtener la cadena de opciones
    let optionsChain: any[] = [];
    try {
      optionsChain = await getOptionsChain('bybit', baseCoin);
    } catch (e: any) {
      console.warn(`[Octavio] Error obteniendo Options Chain: ${e.message}`);
      return;
    }

    // Obtener posiciones abiertas
    const positions = await getUnifiedPositions('bybit');
    const myOptionsPositions = positions.filter((p: Position) => p.symbol.includes('-') && p.qty > 0 && p.symbol.startsWith(baseCoin));

    const now = Date.now();
    if (myOptionsPositions.length > 0) {
      console.log(`${LOG_PREFIX.OCTAVIO} Monitoreando ${myOptionsPositions.length} posiciones de Opciones activas.`);
    } else {
      console.log(`${LOG_PREFIX.OCTAVIO} Escaneando opciones de ${baseCoin}. Contratos disponibles: ${optionsChain.length}`);
    }

    let directiveText = "";
    const ceoDirective = StateService.getOctavioDirective();
    if (ceoDirective) {
      console.log(`${ANSI_COLORS.YELLOW}[Octavio] ¡Grito del CEO recibido ("${ceoDirective}")!${ANSI_COLORS.RESET}`);
      directiveText = `\n\n⚠️ [DIRECTIVA URGENTE DEL CEO]: "${ceoDirective}"`;
      StateService.setOctavioDirective(null);
    }

    // Limitar la data que le enviamos al LLM para no volar el context window
    // Solo enviamos opciones cercanas a expirar (<= 7 días) o las que tengan buen volumen/IV
    const filteredChain = optionsChain.slice(0, 10).map(opt => ({
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
          return;
        }

        if (now - lastActionTime < 10000) return; // Cooldown 10s

        console.log(`${LOG_PREFIX.OCTAVIO} [Acción] ${args.action} en ${args.symbol}. Razón: ${args.reason}`);

        try {
          // Validar existencia del contrato 1 ms antes de ejecutar
          console.log(`${LOG_PREFIX.OCTAVIO} Validando estado del contrato ${args.symbol} en el broker...`);
          try {
            await import('@/features/venues/venue.service').then(m => m.getInstrumentInfo('bybit', args.symbol));
          } catch (validationErr: any) {
            console.log(`${ANSI_COLORS.YELLOW}⚠️ [Octavio] Contrato inválido o expirado en el Broker: ${validationErr.message}. Abortando orden.${ANSI_COLORS.RESET}`);
            return;
          }
          if (args.action === 'OPEN_OPTION') {
            // Lógica simplificada de qty (1 contrato para empezar)
            await executeOrder('bybit', {
              symbol: args.symbol,
              side: args.side,
              qty: 0.1, // En Bybit, BTC options mínimo suele ser 0.1 o 0.01 dependiendo
              type: 'market',
              category: 'option'
            });
          } else if (args.action === 'CLOSE_OPTION') {
             const posToClose = myOptionsPositions.find(p => p.symbol === args.symbol);
             if (posToClose) {
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
}
