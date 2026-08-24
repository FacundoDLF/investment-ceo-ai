import { DateTime } from 'luxon';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import { SYSTEM_INTERVALS, SYSTEM_THRESHOLDS } from '@/shared/constants/system';
import { TRADING_MODES, SYSTEM_STATES, VENUES } from '@/shared/constants/trading';
import { runAgentCycle } from '@/features/agent/services/agent.service';
import { MARKET_STATES } from '@/features/agent/config/ceo.mandate';
import { runResearchAgent } from '@/features/agent/sub-agents/research.agent';
import { runQuantAgent } from '@/features/agent/sub-agents/quant.agent';
import { runMarketScanner } from '@/features/agent/sub-agents/market-scanner.agent';
import { StateService } from '@/features/agent/services/state.service';
import { MissionService } from '@/features/agent/services/mission.service';
import { prisma } from '@/shared/lib/prisma';
import { getUnifiedBalance, getUnifiedPositions, getClosedPositionInfo, VenueName, executeOrder, cancelAllOrders } from '@/features/venues/venue.service';
import { DAMAGE_CONTROL_MANDATE } from '@/features/agent/config/ceo.mandate';
import { startScrappyDaemon } from './scrappy.loop';
import { ModelRouter } from '@/shared/constants/models';

function getMarketStatus() {
  const now = DateTime.now();
  const bymaTime = now.setZone('America/Argentina/Buenos_Aires');
  const wsTime = now.setZone('America/New_York');

  const isWeekday = bymaTime.weekday >= 1 && bymaTime.weekday <= 5;

  let bymaOpen = false;
  let wsPreMarket = false;
  let wsOpen = false;
  let wsAfterHours = false;

  if (isWeekday) {
    const bymaTotalMinutes = bymaTime.hour * 60 + bymaTime.minute;
    if (bymaTotalMinutes >= 10 * 60 + 30 && bymaTotalMinutes < 17 * 60) {
      bymaOpen = true;
    }

    const wsTotalMinutes = wsTime.hour * 60 + wsTime.minute;

    if (wsTotalMinutes >= 4 * 60 && wsTotalMinutes < 9 * 60 + 30) {
      wsPreMarket = true;
    } else if (wsTotalMinutes >= 9 * 60 + 30 && wsTotalMinutes < 16 * 60) {
      wsOpen = true;
    } else if (wsTotalMinutes >= 16 * 60 && wsTotalMinutes < 20 * 60) {
      wsAfterHours = true;
    }
  }

  return { bymaOpen, wsPreMarket, wsOpen, wsAfterHours };
}

let lastResearchTime = 0;
let cachedResearchReport = "Aún no hay reporte macroeconómico.";

let lastScannerTime = 0;
let cachedScannerReport = "Aún no hay reporte del escáner de mercado.";

let iterationCount = 0;
let scrappyInactiveIterations = 0;
let lastLoggedCoinsHash = "";
let lastPositionsMap: Record<string, Record<string, any>> = { alpaca: {}, bybit: {} };
const frozenVenues: Set<VenueName> = new Set();

async function runDaemonIteration(mode?: string) {
  iterationCount++;
  const timestamp = DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm:ss');
  console.log(`\n${LOG_PREFIX.SISTEMA} [${timestamp}] Iniciando iteración #${iterationCount} del CEO Trader (Modo: ${mode || 'Normal'})...`);

  try {
    for (const v of [VENUES.ALPACA, VENUES.BYBIT]) {
      const challenge = await MissionService.getActiveChallenge(v);
      if (challenge && challenge.targetMetric > 0) {
        console.log(`${ANSI_COLORS.CYAN}🎯 Desafío CEO (${v.toUpperCase()}): Tier ${challenge.tier} | Meta: $${challenge.targetMetric.toFixed(2)}${ANSI_COLORS.RESET}`);
      }
    }
    const scrappyState = StateService.getScrappyState();
    if (scrappyState.active) {
      const currentScrappyPnL = await MissionService.getScrappyPnL();
      console.log(`${ANSI_COLORS.MAGENTA}🎯 Desafío Scrappy: Meta $${scrappyState.target} | PnL Actual: $${currentScrappyPnL.toFixed(2)}${ANSI_COLORS.RESET}`);
    }

    const activeVenues: VenueName[] = mode === TRADING_MODES.CRYPTO ? [VENUES.BYBIT] : [VENUES.ALPACA, VENUES.BYBIT];

    // Ejecutar Research Agent cada 1 hora (SYSTEM_INTERVALS.RESEARCH_MS ms)
    const now = Date.now();
    if (now - lastResearchTime > SYSTEM_INTERVALS.RESEARCH_MS) {
      console.log(`${LOG_PREFIX.SISTEMA} Ejecutando a Richard Newman (Analista Macro/Noticias)...`);
      cachedResearchReport = await runResearchAgent('Resumen macroeconómico, eventos clave del día y estado general del mercado de criptomonedas.');
      lastResearchTime = now;
    } else {
      console.log(`${LOG_PREFIX.SISTEMA} Usando caché de Richard Newman (Menos de 1h desde la última ejecución).`);
    }

    // Ejecutar Market Scanner cada 15 minutos (SYSTEM_INTERVALS.SCANNER_MS ms)
    if (mode === TRADING_MODES.CRYPTO) {
      if (now - lastScannerTime > SYSTEM_INTERVALS.SCANNER_MS) {
        console.log(`${LOG_PREFIX.SISTEMA} Ejecutando a Markus Skinner (Escáner de Mercado)...`);
        cachedScannerReport = await runMarketScanner();
        lastScannerTime = now;
      } else {
        console.log(`${LOG_PREFIX.SISTEMA} Usando caché de Markus Skinner (Menos de 15m desde la última ejecución).`);
      }
    }

    for (const venue of activeVenues) {
      if (frozenVenues.has(venue)) {
        console.log(`\n${LOG_PREFIX.SISTEMA} 🧊 OMITIENDO ${venue.toUpperCase()}: El broker se encuentra CONGELADO por Circuit Breaker.`);
        continue;
      }
      console.log(`\n${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}========== [ EVALUANDO CARTERA: ${venue.toUpperCase()} ] ==========${ANSI_COLORS.RESET}`);
      console.log(`${LOG_PREFIX.SISTEMA} Consultando estado de billetera real en ${venue}...`);
      const balance = await getUnifiedBalance(venue);
      const frozenReserve = await MissionService.getFrozenReserve(venue);
      const activeChallenge = await MissionService.getActiveChallenge(venue);

      const spot = balance.spotPower || 0;
      let availableSpot = spot - frozenReserve;
      if (availableSpot < 0) availableSpot = 0;

      const futures = balance.dayTradingPower || 0;
      const hasCapital = availableSpot >= 10 || futures >= 10;

      let currentState: string;
      let marketContext: string;
      let isDamageControl = false;

      // Calcular Unrealized PnL
      const positions = await getUnifiedPositions(venue).catch(() => []);

      // Rastrear posiciones cerradas
      if (iterationCount > 1) {
        const currentSymbols = new Set(positions.map(p => p.symbol));
        for (const [symbol, pos] of Object.entries(lastPositionsMap[venue] || {})) {
          if (!currentSymbols.has(symbol)) {
            const closedInfo = await getClosedPositionInfo(venue, symbol).catch(() => null);
            const reason = closedInfo ? closedInfo.reason : 'Broker (Automático)';
            const pnl = closedInfo ? closedInfo.closedPnl : 0;
            const msgColor = pnl >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
            const sign = pnl >= 0 ? '+' : '';
            console.log(`${LOG_PREFIX.CEO_TRADER} ${msgColor}🛎️ Aviso: La posición en ${symbol} fue cerrada (${reason}). PnL Realizado: ${sign}$${pnl.toFixed(2)}${ANSI_COLORS.RESET}`);
          }
        }
      }

      lastPositionsMap[venue] = {};
      positions.forEach(p => lastPositionsMap[venue][p.symbol] = p);

      const totalUnrealizedPnL = positions.reduce((sum, p) => sum + (p.unrealizedPl || 0), 0);
      const pnlPercentage = balance.cash > 0 ? totalUnrealizedPnL / balance.cash : 0;

      const pnlColor = totalUnrealizedPnL >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
      console.log(`${ANSI_COLORS.CYAN}  💰 ESTADO DE BILLETERA (${venue.toUpperCase()})${ANSI_COLORS.RESET}`);
      console.log(`${ANSI_COLORS.GRAY}  ├─ Total Equity    : ${ANSI_COLORS.GREEN}$${balance.cash.toFixed(2)}${ANSI_COLORS.RESET}`);
      console.log(`${ANSI_COLORS.GRAY}  ├─ Margin Balance  : ${ANSI_COLORS.GREEN}$${futures.toFixed(2)}${ANSI_COLORS.RESET}`);
      console.log(`${ANSI_COLORS.GRAY}  ├─ Spot (Liquidez) : ${ANSI_COLORS.GREEN}$${spot.toFixed(2)}${ANSI_COLORS.RESET}`);
      console.log(`${ANSI_COLORS.GRAY}  └─ Unrealized PnL  : ${pnlColor}$${totalUnrealizedPnL.toFixed(2)} (${(pnlPercentage * 100).toFixed(2)}%)${ANSI_COLORS.RESET}`);

      // Dynamic logging of spot coins
      if (balance.coins && balance.coins.length > 0) {
        const currentCoinsHash = JSON.stringify(balance.coins);
        if (currentCoinsHash !== lastLoggedCoinsHash) {
          lastLoggedCoinsHash = currentCoinsHash;
          console.log(`${ANSI_COLORS.CYAN}  🪙 PORTAFOLIO SPOT (Actualizado)${ANSI_COLORS.RESET}`);
          balance.coins.forEach((c, index) => {
            const isLast = index === balance.coins!.length - 1;
            const prefix = isLast ? '└─' : '├─';
            const usdVal = c.usdValue !== undefined ? ` (~$${c.usdValue.toFixed(2)})` : '';
            console.log(`${ANSI_COLORS.GRAY}  ${prefix} ${c.symbol.padEnd(6)}: ${ANSI_COLORS.GREEN}${c.balance}${ANSI_COLORS.GRAY}${usdVal}${ANSI_COLORS.RESET}`);
          });
        }
      }
      console.log('');

      // EMERGENCY CIRCUIT BREAKER (-25%)
      if (pnlPercentage <= -0.25) {
        console.log(`\n${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🚨🚨 ALERTA ROJA NUCLEAR: EMERGENCY LIQUIDATION (-25% PATRIMONIO) 🚨🚨${ANSI_COLORS.RESET}`);
        console.log(`${ANSI_COLORS.RED}Ejecutando Botón de Pánico: Apagando agentes y liquidando todo a Market.${ANSI_COLORS.RESET}`);

        StateService.setScrappyConfig(false);

        for (const p of positions) {
          if (p.qty > 0) {
            console.log(`[Circuit Breaker] Cancelando órdenes y cerrando ${p.symbol}...`);
            await cancelAllOrders(venue, p.symbol, 'linear').catch(() => { });
            await executeOrder(venue, {
              symbol: p.symbol,
              side: p.side === 'buy' ? 'sell' : 'buy',
              qty: p.qty,
              type: 'market',
              category: 'linear',
              reduceOnly: true
            }).catch(() => { });
          }
        }

        if (balance.coins) {
          for (const c of balance.coins) {
            if (c.symbol !== 'USDT' && c.symbol !== 'USDC') {
              const spotSymbol = `${c.symbol}USDT`;
              await cancelAllOrders(venue, spotSymbol, 'spot').catch(() => { });
              await executeOrder(venue, {
                symbol: spotSymbol,
                side: 'sell',
                qty: c.balance,
                type: 'market',
                category: 'spot'
              }).catch(() => { });
            }
          }
        }

        console.log(`${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🚨 LIQUIDACIÓN COMPLETADA EN ${venue.toUpperCase()}. EL BROKER SE CONGELARÁ (FROZEN) POR SEGURIDAD. 🚨${ANSI_COLORS.RESET}`);
        frozenVenues.add(venue);
        continue;
      }

      // Si el margen disponible es negativo/cero, o el PnL es muy negativo (-5%), forzar Damage Control
      if ((futures <= 0 && balance.cash > 0) || pnlPercentage <= SYSTEM_THRESHOLDS.DAMAGE_CONTROL_PNL) {
        isDamageControl = true;
        console.log(`${LOG_PREFIX.SISTEMA} ${ANSI_COLORS.RED}⚠️ ALERTA ROJA: Entrando en MODO DAMAGE CONTROL (PnL: ${(pnlPercentage * 100).toFixed(2)}%, Futuros: $${futures.toFixed(2)})${ANSI_COLORS.RESET}`);
      }

      // Registrar Snapshot en BD
      await prisma.performanceSnapshot.create({
        data: {
          totalEquity: balance.cash,
          unrealizedPnL: totalUnrealizedPnL,
          notes: `Iteración #${iterationCount} (${venue}) - Estado: ${isDamageControl ? 'DAMAGE_CONTROL' : (iterationCount % 5 === 0 ? 'AUDIT' : 'NORMAL')}`
        }
      });

      if (isDamageControl) {
        currentState = 'DAMAGE_CONTROL';
        marketContext = DAMAGE_CONTROL_MANDATE;
      } else if (iterationCount % 5 === 0) {
        currentState = 'PORTFOLIO_AUDIT';
        marketContext = MARKET_STATES.PORTFOLIO_AUDIT;
        console.log(`${LOG_PREFIX.SISTEMA} 🔍 Iniciando AUDITORÍA DE PORTAFOLIO (Iteración #${iterationCount})${ANSI_COLORS.RESET}`);
      } else if (mode === TRADING_MODES.CRYPTO) {
        currentState = 'CRYPTO_ALWAYS_OPEN';
        marketContext = MARKET_STATES.CRYPTO_ALWAYS_OPEN;
      } else {
        const { bymaOpen, wsPreMarket, wsOpen, wsAfterHours } = getMarketStatus();

        currentState = 'RESEARCH_MODE';
        marketContext = MARKET_STATES.RESEARCH_MODE;

        if (wsOpen || bymaOpen) {
          currentState = 'MARKET_OPEN';
          marketContext = MARKET_STATES.MARKET_OPEN;
        } else if (wsPreMarket) {
          currentState = 'PRE_MARKET_SYNC';
          marketContext = MARKET_STATES.PRE_MARKET_SYNC;
        } else if (wsAfterHours) {
          currentState = 'AFTER_HOURS_REVIEW';
          marketContext = MARKET_STATES.AFTER_HOURS_REVIEW;
        }
      }

      const cosmeticStateMap: Record<string, string> = {
        'CRYPTO_ALWAYS_OPEN': 'Mercado Crypto (24/7)',
        'MARKET_OPEN': 'Mercado Tradicional Abierto (Wall Street/BYMA)',
        'PRE_MARKET_SYNC': 'Mercado Cerrado: Analizando Pre-Market',
        'AFTER_HOURS_REVIEW': 'Mercado Cerrado: Analizando Post-Market',
        'RESEARCH_MODE': 'Mercado Cerrado: Investigación Profunda',
        'PORTFOLIO_AUDIT': 'Auditoría Estricta de Portafolio'
      };
      const prettyState = cosmeticStateMap[currentState] || currentState;

      console.log(`${LOG_PREFIX.SISTEMA} Modo de Operación Actual: ${prettyState}`);


      marketContext += `\n\n**ESTADO DE TU BILLETERA REAL EN ${venue.toUpperCase()}:**\n`;
      marketContext += `- Poder Spot Disponible (Liquidez Real para Operar): ${availableSpot.toFixed(2)}\n`;
      if (frozenReserve > 0) marketContext += `- Fondos en Reserva Intocable (FROZEN): ${frozenReserve.toFixed(2)} (PROHIBIDO TOCAR)\n`;
      marketContext += `- Poder Futuros (Garantía): ${futures.toFixed(2)}\n`;

      if (activeChallenge) {
        marketContext = `**[ MISIÓN ACTUAL DE LA BÓVEDA (${venue.toUpperCase()}) ]**\n🎯 ${activeChallenge.title}\n📜 ${activeChallenge.description}\n📈 Meta de Patrimonio Total: ${activeChallenge.targetMetric}\n💰 Patrimonio Total Actual: ${balance.cash.toFixed(2)}\n\n` + marketContext;
      }
      if (!hasCapital) {
        marketContext += `\n⚠️ **ATENCIÓN: CAPITAL INSUFICIENTE.** No tienes saldo disponible para abrir nuevas posiciones. Tu prioridad absoluta debe ser decidir si esperas o si cierras posiciones activas para liberar capital. No intentes analizar nuevas compras.\n`;
      }

      if (venue === 'bybit') {
        const scrappyConfig = StateService.getScrappyState();
        if (!scrappyConfig.active) {
          scrappyInactiveIterations++;
        } else {
          scrappyInactiveIterations = 0;
        }

        if (scrappyInactiveIterations >= 3) {
          marketContext += `\n🚨 **ALERTA CRÍTICA:** Scrappy ha estado inactivo por ${scrappyInactiveIterations} iteraciones. ¡DESPIÉRTALO AHORA! Es OBLIGATORIO que uses 'command_scrappy' en esta respuesta para asignarle una Misión Fetch (Presupuesto y Meta), incluso si lo haces investigar BTCUSDT u otra moneda.\n`;
        }
      }

      if (currentState !== 'RESEARCH_MODE') {
        const latestInsight = await prisma.marketInsight.findFirst({
          orderBy: { createdAt: 'desc' },
        });

        if (latestInsight) {
          marketContext += `\n\n**Último Análisis de Fin de Semana (Market Insight BD):**\nContexto: ${latestInsight.context}\nSeveridad: ${latestInsight.severity}\nAcción Deducida: ${latestInsight.deducedAction}`;
        }
      }

      console.log(`${LOG_PREFIX.SISTEMA} Evaluando ejecución de Sub-Agentes...`);

      // El quant agent analiza SPY en alpaca, o criptos en bybit
      const targetAsset = venue === 'bybit' ? StateService.getCurrentCryptoAsset() : 'SPY';
      const assetsToAnalyze = new Set<string>();
      assetsToAnalyze.add(targetAsset);

      if (venue === 'bybit' && balance.coins) {
        balance.coins.forEach(c => {
          if (c.symbol !== 'USDT' && c.symbol !== 'USDC') {
            assetsToAnalyze.add(`${c.symbol}USDT`);
          }
        });
      }

      const assetsArray = Array.from(assetsToAnalyze);
      let quantReport = "No se ejecutó Quant Agent por falta de liquidez (Ahorro de recursos).";

      if (hasCapital) {
        console.log(`${LOG_PREFIX.SISTEMA} Despertando a Rick Queen (Quant Agent) para analizar ${assetsArray.join(', ')}...`);
        quantReport = await runQuantAgent(assetsArray, venue);
      } else {
        console.log(`${LOG_PREFIX.SISTEMA} Omitiendo a Rick Queen: Saldo insuficiente (${availableSpot.toFixed(2)} Spot Disponible / ${futures.toFixed(2)} Futuros).`);
      }

      console.log(`${LOG_PREFIX.SISTEMA} Reportes listos. Entregando al CEO Trader para toma de decisiones...`);

      // Inyectar reportes al contexto del CEO
      marketContext += `\n\n**Reporte de Richard Newman (Macro/Noticias):**\n${cachedResearchReport}`;
      marketContext += `\n\n**Reporte de Rick Queen (Precios y Riesgo en Vivo):**\n${quantReport}`;
      if (mode === TRADING_MODES.CRYPTO) {
        marketContext += `\n\n**Reporte de Markus Skinner (Oportunidades):**\n${cachedScannerReport}`;
      }

      const scrappyConf = StateService.getScrappyState();
      if (scrappyConf.active && venue === 'bybit') {
        const scrappyReport = await MissionService.getScrappyReport();
        if (scrappyReport && scrappyReport !== "Sin reportes recientes. Esperando órdenes.") {
          marketContext += `\n\n**MENSAJE URGENTE DE SCRAPPY (Ejecutor HFT):**\n${scrappyReport}\n(Evalúa si quieres apagarlo, subirle el budget, o dejarlo corriendo solo).`;
          await MissionService.setScrappyReport("Sin reportes recientes. Esperando órdenes."); // Borrar buzón tras leerlo
        }
      }

      const scrappyExclusion = scrappyConf.active && venue === 'bybit' ? ` IGNORA y NO CIERRES la posición en ${scrappyConf.targetAsset} porque es gestionada independientemente por el bot HFT Scrappy (no requiere thesis).` : '';

      const agentPrompt = isDamageControl
        ? `ESTÁS EN MODO DAMAGE CONTROL. Revisa tus posiciones, cierra las que no tengan sentido o generen gran pérdida. NO ABRAS NUEVAS POSICIONES. REGLA ESTRICTA: SOLO estás autorizado a interactuar y modificar posiciones en el broker activo: ${venue.toUpperCase()}. Ignora por completo tu balance o posiciones en otros brokers.${scrappyExclusion}`
        : (currentState === 'PORTFOLIO_AUDIT'
          ? `ESTÁS EN AUDITORÍA DE PORTAFOLIO. Lee la 'thesis' de cada posición abierta de tus herramientas. Compara con los precios actuales. CIERRA las posiciones si la tesis falló. NO ABRAS NUEVAS. REGLA ESTRICTA: SOLO estás autorizado a interactuar y modificar posiciones en el broker activo: ${venue.toUpperCase()}. Ignora por completo tu balance o posiciones en otros brokers.${scrappyExclusion}`
          : `Analiza los reportes de tus sub-agentes y el estado del mercado. Tómate el tiempo necesario para pensar. Quiero decisiones QUIRÚRGICAS, basadas en fundamentos técnicos y lógicos, respaldadas por información verificable. Tu análisis debe ser exhaustivo, claro, metodológico, experto y profesional. Tu objetivo es sobrevivir, no perder capital y maximizar tu portafolio de forma inteligente. En modo crypto, operas 24/7 sin descanso. REGLA ESTRICTA: SOLO estás autorizado a operar en el broker activo: ${venue.toUpperCase()}. Ignora tu balance en otros brokers.${scrappyExclusion}`);

      const agentResponse = await runAgentCycle(
        agentPrompt,
        marketContext
      );

      console.log(`${LOG_PREFIX.CEO_TRADER} Respuesta obtenida y ciclo cerrado.\x1b[0m`);

      let finalContent = typeof agentResponse === 'string' ? agentResponse : (agentResponse?.content || '');

      const titleMatch = finalContent.match(/\[T[IÍ]TULO:([^\]]+)\]/i);
      if (titleMatch) {
        console.log(`${LOG_PREFIX.AUDITORIA} ${titleMatch[1].trim()}${ANSI_COLORS.RESET}`);
      } else {
        console.log(`${LOG_PREFIX.AUDITORIA} Ciclo completado sin acciones.${ANSI_COLORS.RESET}`);
      }


      // === MILESTONE AUDITOR ===
      const effectiveEquity = balance.cash - frozenReserve;

      // Si el objetivo es 0 (primera ejecución para este broker), inicializarlo dinámicamente
      if (activeChallenge && activeChallenge.targetMetric === 0) {
        await MissionService.setCycleStep(venue, 0);
        await MissionService.setWorkingCapital(venue, effectiveEquity);

        const currentPercentage = MissionService.TIER_PERCENTAGES[0];
        const initialTarget = MissionService.SALARY_RESERVE + (effectiveEquity * (1 + currentPercentage));

        await MissionService.setCurrentTarget(venue, initialTarget);
        activeChallenge.targetMetric = initialTarget;
        console.log(`\n${ANSI_COLORS.CYAN}🎯 Hito autogenerado para ${venue.toUpperCase()}: Meta Efectiva inicial fijada en $${initialTarget.toFixed(2)}${ANSI_COLORS.RESET}\n`);
      }

      // Evaluar Victoria sobre el PATRIMONIO EFECTIVO
      if (activeChallenge && activeChallenge.targetMetric > 0 && effectiveEquity >= activeChallenge.targetMetric) {
        console.log(`\n${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}🎉 ¡HITO LOGRADO EN ${venue.toUpperCase()}! 🎉${ANSI_COLORS.RESET}`);
        console.log(`${ANSI_COLORS.GREEN}Meta Efectiva alcanzada: $${effectiveEquity.toFixed(2)} / $${activeChallenge.targetMetric.toFixed(2)}${ANSI_COLORS.RESET}`);

        const newFrozen = frozenReserve + MissionService.SALARY_RESERVE;
        await MissionService.setFrozenReserve(venue, newFrozen);

        const newWorkingCapital = effectiveEquity - MissionService.SALARY_RESERVE;
        await MissionService.setWorkingCapital(venue, newWorkingCapital);

        let step = await MissionService.getCycleStep(venue);
        step++;
        await MissionService.setCycleStep(venue, step);

        const nextPercentage = MissionService.TIER_PERCENTAGES[step % MissionService.TIER_PERCENTAGES.length];
        const newTarget = MissionService.SALARY_RESERVE + (newWorkingCapital * (1 + nextPercentage));
        await MissionService.setCurrentTarget(venue, newTarget);

        const nextTier = activeChallenge.tier + 1;
        await MissionService.setActiveTier(venue, nextTier);

        console.log(`${ANSI_COLORS.CYAN}Sueldo de $${MissionService.SALARY_RESERVE} asegurado. Reserva Total: $${newFrozen.toFixed(2)}.${ANSI_COLORS.RESET}`);
        console.log(`${ANSI_COLORS.CYAN}Avanzando al Tier ${nextTier} (${(nextPercentage * 100).toFixed(0)}%). Nueva meta efectiva: $${newTarget.toFixed(2)}.${ANSI_COLORS.RESET}\n`);
      }

    } // Fin bucle venues

  } catch (error: any) {
    if (error.message?.includes('tool_use_failed') || error.message?.includes('tool call validation failed')) {
      const errWarnTimestamp = DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm:ss');
      console.warn(`${LOG_PREFIX.SISTEMA} [${errWarnTimestamp}] ${ANSI_COLORS.RED}[Aviso] Un sub-agente falló al generar JSON válido (tool_use_failed). Ignorando ciclo...${ANSI_COLORS.RESET}`);
    } else {
      const errTimestamp = DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm:ss');
      console.error(`${LOG_PREFIX.SISTEMA} [${errTimestamp}] ${ANSI_COLORS.RED}[Alarma Crítica] El ciclo falló o fue interrumpido. Motivo: ${error.message || 'Desconocido'}${ANSI_COLORS.RESET}`);
      console.error(`${LOG_PREFIX.SISTEMA} ${ANSI_COLORS.RED}Deteniendo el daemon por completo para revisión manual.${ANSI_COLORS.RESET}`);
      process.exit(1);
    }
  }
}

export async function startCeoDaemon(initialIntervalSeconds = 60, mode?: string) {
  const asciiBrain = `${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}
       _---~~~~~-_.
     _{        )   )
   ,   ) -~~- ( ,-' )_
  (  \`-,_..\`., )-- '_,)
 ( \` _)  (  -~( -_ \`,  }
 (_-  _  ~_-~~~~',  ,' )
   \`~ -^(    __;-,((()))
         ~~~~ {_ -_(())
                \`\\  }
                  { }

  ___                         _                         _   
 |_ _| _ __ __    __ ___  ___| |_ _ __ ___   ___  _ __ | |_ 
  | | | '_ \\\\ \\  / // _ \\| __| __| '_ \` _ \\ / _ \\| '_ \\| __|
  | | | | | |\\ \\/ /|  __/\\_ || |_| | | | | |  __/| | | | |_ 
 |___||_| |_| \\__/  \\____|___|\\__|_| |_| |_|\\____|_| |_|\\__|
  _____ _____ _____       __     ___ 
 |  __||  ___|  _  |     /  \\   |_ _|
 | |   |  _| | | | |    /    \\   | | 
 | |___| |___| |_| |   /  __  \\  | | 
 |_____|_____|_____|  /__/  \\__\\|___|

  \x1b[0m
  ${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}Investment CEO AI(Modo: ${mode || 'Normal'}) ${ANSI_COLORS.RESET}\n`;

  console.log(asciiBrain);
  ModelRouter.printRegistryTable();

  while (true) {
    await runDaemonIteration(mode);

    let currentInterval = initialIntervalSeconds;

    // Aceleración Dinámica para Crypto
    if (mode === TRADING_MODES.CRYPTO) {
      const now = DateTime.now().setZone('America/New_York');
      const totalMinutes = now.hour * 60 + now.minute;

      const isMorningPeak = totalMinutes >= 9 * 60 + 30 && totalMinutes <= 11 * 60 + 30; // 09:30 a 11:30 NY
      const isAsianPeak = totalMinutes >= 20 * 60 && totalMinutes <= 22 * 60; // 20:00 a 22:00 NY

      if (isMorningPeak || isAsianPeak) {
        currentInterval = SYSTEM_INTERVALS.CEO_PEAK_SEC; // Aceleración: cada 5 segundos en horarios pico
      } else {
        currentInterval = SYSTEM_INTERVALS.CEO_BASE_SEC; // Valle: cada 60 segundos
      }
    }

    console.log(`\n${LOG_PREFIX.SISTEMA} ⏳ El CEO entró en espera estratégica por ${currentInterval} segundos...`);

    // Si Scrappy está inactivo, lo aclaramos para no generar confusión sobre qué está haciendo.
    // Si está activo, no hace falta aclarar porque Scrappy floodea la consola con sus radares.
    const scrappyState = StateService.getScrappyState();
    if (!scrappyState.active) {
      console.log(`${LOG_PREFIX.SCRAPPY} 💤 Mantenimiento en progreso (APAGADO). A la espera de directivas del CEO.\n`);
    }
    await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));
  }
}

if (require.main === module) {
  const modeArg = process.argv.includes(TRADING_MODES.CRYPTO) ? TRADING_MODES.CRYPTO : undefined;

  // Scrappy se inicia en todos los modos (tanto regular como crypto)
  startScrappyDaemon().catch(console.error);

  // Intervalo base de 60s, la lógica interna lo acelerará si es crypto y horario pico
  startCeoDaemon(SYSTEM_INTERVALS.CEO_BASE_SEC, modeArg).catch(console.error);
}
