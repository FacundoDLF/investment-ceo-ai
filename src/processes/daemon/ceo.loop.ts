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
import { prisma } from '@/shared/lib/prisma';
import { getUnifiedBalance, getUnifiedPositions, VenueName } from '@/features/venues/venue.service';
import { DAMAGE_CONTROL_MANDATE } from '@/features/agent/config/ceo.mandate';
import { startScrappyDaemon } from './scrappy.loop';

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

async function runDaemonIteration(mode?: string) {
  iterationCount++;
  console.log(`\n${LOG_PREFIX.SISTEMA} Iniciando iteración #${iterationCount} del CEO Trader (Modo: ${mode || 'Normal'})...`);

  try {
    const venue: VenueName = mode === TRADING_MODES.CRYPTO ? VENUES.BYBIT : VENUES.ALPACA;
    console.log(`${LOG_PREFIX.SISTEMA} Consultando estado de billetera real en ${venue}...`);
    const balance = await getUnifiedBalance(venue);
    const spot = balance.spotPower || 0;
    const futures = balance.dayTradingPower || 0;
    const hasCapital = spot >= 10 || futures >= 10;

    let currentState: string;
    let marketContext: string;
    let isDamageControl = false;

    // Calcular Unrealized PnL
    const positions = await getUnifiedPositions(venue).catch(() => []);
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + (p.unrealizedPl || 0), 0);
    const pnlPercentage = balance.cash > 0 ? totalUnrealizedPnL / balance.cash : 0;

    // Si el margen disponible es negativo/cero, o el PnL es muy negativo (-5%), forzar Damage Control
    if ((futures <= 0 && balance.cash > 0) || pnlPercentage <= SYSTEM_THRESHOLDS.DAMAGE_CONTROL_PNL) {
      isDamageControl = true;
      console.log(`${LOG_PREFIX.SISTEMA_CRITICO} ⚠️ ALERTA ROJA: Entrando en MODO DAMAGE CONTROL (PnL: ${(pnlPercentage*100).toFixed(2)}%, Futuros: $${futures.toFixed(2)})${ANSI_COLORS.RESET}`);
    }

    // Registrar Snapshot en BD
    await prisma.performanceSnapshot.create({
      data: {
        totalEquity: balance.cash,
        unrealizedPnL: totalUnrealizedPnL,
        notes: `Iteración #${iterationCount} - Estado: ${isDamageControl ? 'DAMAGE_CONTROL' : (iterationCount % 5 === 0 ? 'AUDIT' : 'NORMAL')}`
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

    console.log(`${LOG_PREFIX.SISTEMA} Estado actual de mercados detectado: ${currentState}`);

    marketContext += `\n\n**ESTADO DE TU BILLETERA REAL EN ${venue.toUpperCase()}:**\n`;
    marketContext += `- Poder Spot (Liquidez): $${spot.toFixed(2)}\n`;
    marketContext += `- Poder Futuros (Garantía): $${futures.toFixed(2)}\n`;
    if (!hasCapital) {
      marketContext += `\n⚠️ **ATENCIÓN: CAPITAL INSUFICIENTE.** No tienes saldo disponible para abrir nuevas posiciones. Tu prioridad absoluta debe ser decidir si esperas o si cierras posiciones activas para liberar capital. No intentes analizar nuevas compras.\n`;
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

    // Ejecutar Research Agent cada 1 hora (SYSTEM_INTERVALS.RESEARCH_MS ms)
    const now = Date.now();
    if (now - lastResearchTime > SYSTEM_INTERVALS.RESEARCH_MS) {
      console.log(`${LOG_PREFIX.SISTEMA} Ejecutando a Richard Newman (Analista Macro/Noticias)...`);
      cachedResearchReport = await runResearchAgent('Resumen macroeconómico, eventos clave del día y estado general del mercado de criptomonedas.');
      lastResearchTime = now;

      // Podríamos guardar el insight en base de datos aquí si lo necesitamos persistente
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

    // El quant agent analiza SPY por defecto en modo normal, o el activo actual en modo crypto
    const assetToAnalyze = mode === TRADING_MODES.CRYPTO ? StateService.getCurrentCryptoAsset() : 'SPY';
    let quantReport = "No se ejecutó Quant Agent por falta de liquidez (Ahorro de recursos).";

    if (hasCapital) {
      console.log(`${LOG_PREFIX.SISTEMA} Despertando a Rick Queen (Quant Agent) para analizar ${assetToAnalyze}...`);
      quantReport = await runQuantAgent(assetToAnalyze, venue);
    } else {
      console.log(`${LOG_PREFIX.SISTEMA} Omitiendo a Rick Queen: Saldo insuficiente ($${spot.toFixed(2)} Spot / $${futures.toFixed(2)} Futuros).`);
    }

    console.log(`${LOG_PREFIX.SISTEMA} Reportes listos. Entregando al CEO Trader para toma de decisiones...`);

    // Inyectar reportes al contexto del CEO
    marketContext += `\n\n**Reporte de Richard Newman (Macro/Noticias):**\n${cachedResearchReport}`;
    marketContext += `\n\n**Reporte de Rick Queen (Precios y Riesgo en Vivo):**\n${quantReport}`;
    if (mode === TRADING_MODES.CRYPTO) {
      marketContext += `\n\n**Reporte de Markus Skinner (Oportunidades):**\n${cachedScannerReport}`;
    }

    const agentPrompt = isDamageControl 
      ? `ESTÁS EN MODO DAMAGE CONTROL. Revisa tus posiciones, cierra las que no tengan sentido o generen gran pérdida. NO ABRAS NUEVAS POSICIONES. REGLA ESTRICTA: SOLO estás autorizado a interactuar y modificar posiciones en el broker activo: ${venue.toUpperCase()}. Ignora por completo tu balance o posiciones en otros brokers.`
      : (currentState === 'PORTFOLIO_AUDIT' 
        ? `ESTÁS EN AUDITORÍA DE PORTAFOLIO. Lee la 'thesis' de cada posición abierta de tus herramientas. Compara con los precios actuales. CIERRA las posiciones si la tesis falló. NO ABRAS NUEVAS. REGLA ESTRICTA: SOLO estás autorizado a interactuar y modificar posiciones en el broker activo: ${venue.toUpperCase()}. Ignora por completo tu balance o posiciones en otros brokers.`
        : `Analiza los reportes de tus sub-agentes, el estado del mercado actual y ejecuta operaciones segundo a segundo si encuentras una oportunidad clara según tu Risk Engine. Tu objetivo es sobrevivir, no perder capital y maximizar tu portafolio. En modo crypto, operas 24/7 sin descanso. REGLA ESTRICTA: SOLO estás autorizado a operar en el broker activo: ${venue.toUpperCase()}. Ignora tu balance en otros brokers.`);

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

  } catch (error: any) {
    if (error.message?.includes('tool_use_failed') || error.message?.includes('tool call validation failed')) {
      console.warn(`${LOG_PREFIX.SISTEMA_CRITICO} [Aviso] Un sub-agente falló al generar JSON válido (tool_use_failed). Ignorando ciclo...${ANSI_COLORS.RESET}`);
      return;
    }
    console.error(`${LOG_PREFIX.SISTEMA_CRITICO} [Alarma Crítica] El ciclo falló o fue interrumpido. Motivo: ${error.message || 'Desconocido'}${ANSI_COLORS.RESET}`);
    console.error(`${LOG_PREFIX.SISTEMA_CRITICO} Deteniendo el daemon por completo para revisión manual.${ANSI_COLORS.RESET}`);
    process.exit(1);
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

    console.log(`Durmiendo por ${currentInterval} segundos...`);
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
