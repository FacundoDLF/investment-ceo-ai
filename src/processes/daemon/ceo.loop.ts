import { DateTime } from 'luxon';
import { runAgentCycle } from '@/features/agent/services/agent.service';
import { MARKET_STATES } from '@/features/agent/config/ceo.mandate';
import { runResearchAgent } from '@/features/agent/sub-agents/research.agent';
import { runQuantAgent } from '@/features/agent/sub-agents/quant.agent';
import { runMarketScanner } from '@/features/agent/sub-agents/market-scanner.agent';
import { StateService } from '@/features/agent/services/state.service';
import { prisma } from '@/shared/lib/prisma';
import { getUnifiedBalance, getUnifiedPositions, VenueName } from '@/features/venues/venue.service';
import { DAMAGE_CONTROL_MANDATE } from '@/features/agent/config/ceo.mandate';

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
  console.log(`\n\x1b[33m[Sistema]\x1b[0m Iniciando iteración #${iterationCount} del CEO Trader (Modo: ${mode || 'Normal'})...`);

  try {
    const venue: VenueName = mode === 'crypto' ? 'bybit' : 'alpaca';
    console.log(`\x1b[33m[Sistema]\x1b[0m Consultando estado de billetera real en ${venue}...`);
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
    if ((futures <= 0 && balance.cash > 0) || pnlPercentage <= -0.05) {
      isDamageControl = true;
      console.log(`\x1b[31m[Sistema] ⚠️ ALERTA ROJA: Entrando en MODO DAMAGE CONTROL (PnL: ${(pnlPercentage*100).toFixed(2)}%, Futuros: $${futures.toFixed(2)})\x1b[0m`);
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
      console.log(`\x1b[35m[Sistema] 🔍 Iniciando AUDITORÍA DE PORTAFOLIO (Iteración #${iterationCount})\x1b[0m`);
    } else if (mode === 'crypto') {
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

    console.log(`\x1b[33m[Sistema]\x1b[0m Estado actual de mercados detectado: ${currentState}`);

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

    console.log('\x1b[33m[Sistema]\x1b[0m Evaluando ejecución de Sub-Agentes...');

    // Ejecutar Research Agent cada 1 hora (3600000 ms)
    const now = Date.now();
    if (now - lastResearchTime > 3600000) {
      console.log('\x1b[33m[Sistema]\x1b[0m Ejecutando Analista de Noticias (Contexto Global)...');
      cachedResearchReport = await runResearchAgent('Resumen macroeconómico, eventos clave del día y estado general del mercado de criptomonedas.');
      lastResearchTime = now;

      // Podríamos guardar el insight en base de datos aquí si lo necesitamos persistente
    } else {
      console.log('\x1b[33m[Sistema]\x1b[0m Usando caché del Research Agent (Menos de 1h desde la última ejecución).');
    }

    // Ejecutar Market Scanner cada 15 minutos (900000 ms)
    if (mode === 'crypto') {
      if (now - lastScannerTime > 900000) {
        console.log('\x1b[33m[Sistema]\x1b[0m Ejecutando Scanner de Mercado (Oportunidades Bybit)...');
        cachedScannerReport = await runMarketScanner();
        lastScannerTime = now;
      } else {
        console.log('\x1b[33m[Sistema]\x1b[0m Usando caché del Market Scanner (Menos de 15m desde la última ejecución).');
      }
    }

    // El quant agent analiza SPY por defecto en modo normal, o el activo actual en modo crypto
    const assetToAnalyze = mode === 'crypto' ? StateService.getCurrentCryptoAsset() : 'SPY';
    let quantReport = "No se ejecutó Quant Agent por falta de liquidez (Ahorro de recursos).";

    if (hasCapital) {
      console.log(`\x1b[33m[Sistema]\x1b[0m Iniciando Quant Agent para activo principal (${assetToAnalyze}) buscando variaciones...`);
      quantReport = await runQuantAgent(assetToAnalyze, venue);
    } else {
      console.log(`\x1b[33m[Sistema]\x1b[0m Omitiendo Quant Agent: Saldo insuficiente ($${spot.toFixed(2)} Spot / $${futures.toFixed(2)} Futuros).`);
    }

    console.log('\x1b[33m[Sistema]\x1b[0m Reportes listos. Entregando al CEO Trader para toma de decisiones...');

    // Inyectar reportes al contexto del CEO
    marketContext += `\n\n**Reporte del Research Agent (Macro/Noticias):**\n${cachedResearchReport}`;
    marketContext += `\n\n**Reporte del Quant Agent (Precios y Riesgo en Vivo):**\n${quantReport}`;
    if (mode === 'crypto') {
      marketContext += `\n\n**Reporte del Market Scanner (Oportunidades):**\n${cachedScannerReport}`;
    }

    const agentPrompt = isDamageControl 
      ? `ESTÁS EN MODO DAMAGE CONTROL. Revisa tus posiciones, cierra las que no tengan sentido o generen gran pérdida. NO ABRAS NUEVAS POSICIONES.`
      : (currentState === 'PORTFOLIO_AUDIT' 
        ? `ESTÁS EN AUDITORÍA DE PORTAFOLIO. Lee la 'thesis' de cada posición abierta de tus herramientas. Compara con los precios actuales. CIERRA las posiciones si la tesis falló. NO ABRAS NUEVAS.`
        : `Analiza los reportes de tus sub-agentes, el estado del mercado actual y ejecuta operaciones segundo a segundo si encuentras una oportunidad clara según tu Risk Engine. Tu objetivo es sobrevivir, no perder capital y maximizar tu portafolio. En modo crypto, operas 24/7 sin descanso.`);

    const agentResponse = await runAgentCycle(
      agentPrompt,
      marketContext
    );

    console.log('\x1b[36m[CEO Trader] Respuesta obtenida y ciclo cerrado.\x1b[0m');
    if (agentResponse && typeof agentResponse === 'object' && 'content' in agentResponse) {
      console.log(agentResponse.content);
    } else {
      console.log(agentResponse);
    }

  } catch (error: any) {
    console.error(`\x1b[31m[Sistema] [Alarma Crítica] El ciclo falló o fue interrumpido. Motivo: ${error.message || 'Desconocido'}\x1b[0m`);
    console.error(`\x1b[31m[Sistema] Deteniendo el daemon por completo para revisión manual.\x1b[0m`);
    process.exit(1);
  }
}

export async function startCeoDaemon(initialIntervalSeconds = 60, mode?: string) {
  const asciiBrain = `\x1b[36m\x1b[1m
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
  \x1b[32m\x1b[1mInvestment CEO AI(Modo: ${mode || 'Normal'}) \x1b[0m\n`;

  console.log(asciiBrain);

  while (true) {
    await runDaemonIteration(mode);

    let currentInterval = initialIntervalSeconds;

    // Aceleración Dinámica para Crypto
    if (mode === 'crypto') {
      const now = DateTime.now().setZone('America/New_York');
      const totalMinutes = now.hour * 60 + now.minute;

      const isMorningPeak = totalMinutes >= 9 * 60 + 30 && totalMinutes <= 11 * 60 + 30; // 09:30 a 11:30 NY
      const isAsianPeak = totalMinutes >= 20 * 60 && totalMinutes <= 22 * 60; // 20:00 a 22:00 NY

      if (isMorningPeak || isAsianPeak) {
        currentInterval = 5; // Aceleración: cada 5 segundos en horarios pico
      } else {
        currentInterval = 60; // Valle: cada 60 segundos
      }
    }

    console.log(`Durmiendo por ${currentInterval} segundos...`);
    await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));
  }
}

if (require.main === module) {
  const modeArg = process.argv.includes('crypto') ? 'crypto' : undefined;
  // Intervalo base de 60s, la lógica interna lo acelerará si es crypto y horario pico
  startCeoDaemon(60, modeArg).catch(console.error);
}
