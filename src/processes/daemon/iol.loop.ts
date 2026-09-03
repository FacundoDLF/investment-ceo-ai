import * as readline from 'readline';
import { DateTime } from 'luxon';
import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';
import { SYSTEM_INTERVALS, SYSTEM_THRESHOLDS } from '@/shared/constants/system';
import { MARKET_STATES } from '@/features/agent/config/ceo.mandate';
import { runResearchAgent } from '@/features/agent/sub-agents/research.agent';
import { StateService } from '@/features/agent/services/state.service';
import { MissionService } from '@/features/agent/services/mission.service';
import { prisma } from '@/shared/lib/prisma';
import { getUnifiedBalance, getUnifiedPositions, getClosedPositionInfo } from '@/features/venues/venue.service';
import { DAMAGE_CONTROL_MANDATE } from '@/features/agent/config/ceo.mandate';
import { startOctavioDaemon } from './octavio.loop';
import { ModelRouter } from '@/shared/constants/models';
import { runAgentCycle } from '@/features/agent/services/agent.service';
import { getIolAccessToken } from '@/features/venues/iol.auth';
import { venueRegistry } from '@/features/venues/venue.service';

process.env.CEO_MODE = 'iol'; // Inyectar modo para getAccountState

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // @ts-ignore
    rl._writeToOutput = function _writeToOutput(stringToWrite: string) {
      // @ts-ignore
      if (rl.stdoutMuted && stringToWrite !== '\r\n' && stringToWrite !== '\n') rl.output.write('*');
      // @ts-ignore
      else rl.output.write(stringToWrite);
    };
    rl.question(query, (answer) => { rl.close(); resolve(answer); });
    // @ts-ignore
    rl.stdoutMuted = true;
  });
}

function promptNormal(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => { rl.close(); resolve(answer); });
  });
}

const DAEMON_START_TIME = Date.now();
function formatUptime(): string {
  const diff = Math.floor((Date.now() - DAEMON_START_TIME) / 1000);
  return `${Math.floor(diff / 86400)}d ${Math.floor((diff % 86400) / 3600)}h ${Math.floor((diff % 3600) / 60)}m ${diff % 60}s`;
}

let cachedMarketStatus = { bymaOpen: false };
let lastMarketStatusCheck = 0;

function getBymaMarketStatus() {
  const nowMs = Date.now();
  if (nowMs - lastMarketStatusCheck < 60000) return cachedMarketStatus;

  const now = DateTime.now().setZone('America/Argentina/Buenos_Aires');
  const isWeekday = now.weekday >= 1 && now.weekday <= 5;
  let bymaOpen = false;

  if (isWeekday) {
    const totalMinutes = now.hour * 60 + now.minute;
    if (totalMinutes >= 11 * 60 && totalMinutes < 17 * 60) bymaOpen = true; // 11:00 a 17:00 BA
  }

  cachedMarketStatus = { bymaOpen };
  lastMarketStatusCheck = nowMs;
  return cachedMarketStatus;
}

let lastResearchTime = 0;
let cachedResearchReport = "Aún no hay reporte macroeconómico.";
let iterationCount = 0;
let lastPositionsMap: Record<string, any> = {};

async function runIolIteration() {
  iterationCount++;
  const timestamp = DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('dd/MM/yyyy HH:mm:ss');
  console.log(`\n${LOG_PREFIX.SISTEMA} [${timestamp}] Iniciando iteración #${iterationCount} del CEO Trader (Modo: IOL) | Running: ${formatUptime()}...`);

  try {
    const octavioState = StateService.getOctavioState();
    if (octavioState.active) {
      const currentOctavioPnL = await MissionService.getOctavioPnL();
      console.log(`${ANSI_COLORS.CYAN}Desafío Octavio: Meta $${octavioState.target} | PnL Actual: $${currentOctavioPnL.toFixed(2)}${ANSI_COLORS.RESET}`);
    }

    const now = Date.now();
    if (now - lastResearchTime > SYSTEM_INTERVALS.RESEARCH_MS) {
      console.log(`${LOG_PREFIX.SISTEMA} Ejecutando a Richard Newman (Analista Macro/Noticias)...`);
      cachedResearchReport = await runResearchAgent('Resumen económico de Argentina, impacto del dólar MEP/CCL y mercado BYMA.');
      lastResearchTime = now;
    }

    console.log(`\n${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}========== [ EVALUANDO CARTERA: IOL ] ==========${ANSI_COLORS.RESET}`);
    console.log(`${LOG_PREFIX.SISTEMA} Consultando estado de billetera en IOL...`);
    const balance = await getUnifiedBalance('iol');
    const positions = await getUnifiedPositions('iol').catch(() => []);

    const spot = balance.cash || 0;
    const availableSpot = spot;
    let isDamageControl = false;
    let currentState: string;
    let marketContext: string;

    const totalMarketValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const totalEquity = spot + totalMarketValue;
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + (p.unrealizedPl || 0), 0);
    
    // El PnL total debe calcularse sobre el capital invertido, no sobre el cash libre
    const investedCapital = totalMarketValue - totalUnrealizedPnL;
    const pnlPercentage = investedCapital > 0 ? totalUnrealizedPnL / investedCapital : 0;
    const pnlColor = totalUnrealizedPnL >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;

    let mepRate = 0;
    try {
      const { getCotizacionMep } = await import('@/features/venues/iol.api');
      const mepData = await getCotizacionMep();
      
      // Dump raw mep data for debugging
      try {
        const fs = await import('fs');
        fs.writeFileSync('iol_debug_mep.json', JSON.stringify(mepData, null, 2));
      } catch(e) {}

      mepRate = mepData.valor || mepData.ultimoPrecio || mepData.precio || 0;
      if (!mepRate && Array.isArray(mepData) && mepData.length > 0) {
        mepRate = mepData[0].ultimoPrecio || mepData[0].valor || 0;
      }
      if (!mepRate) {
        console.log(`${ANSI_COLORS.YELLOW}⚠️ [IOL API] No se pudo parsear el valor del dólar MEP. Raw: ${JSON.stringify(mepData)}${ANSI_COLORS.RESET}`);
      }
    } catch(e: any) {
      console.log(`${ANSI_COLORS.YELLOW}⚠️ [IOL API] Error obteniendo cotización MEP: ${e.message}${ANSI_COLORS.RESET}`);
    }
    
    const mepStr = mepRate > 0 ? ` / USD ${(totalEquity / mepRate).toFixed(2)}` : '';
    const spotMepStr = mepRate > 0 ? ` / USD ${(spot / mepRate).toFixed(2)}` : '';
    const pnlMepStr = mepRate > 0 ? ` / USD ${(totalUnrealizedPnL / mepRate).toFixed(2)}` : '';

    console.log(`${ANSI_COLORS.CYAN}  ESTADO DE BILLETERA (IOL)${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.GRAY}  ├─ Valorizado Total : ${ANSI_COLORS.GREEN}$${totalEquity.toFixed(2)}${mepStr}${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.GRAY}  ├─ Spot (Liquidez)  : ${ANSI_COLORS.GREEN}$${spot.toFixed(2)}${spotMepStr}${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.GRAY}  └─ Unrealized PnL   : ${pnlColor}$${totalUnrealizedPnL.toFixed(2)}${pnlMepStr} (${(pnlPercentage * 100).toFixed(2)}%)${ANSI_COLORS.RESET}`);

    if (balance.coins && balance.coins.length > 0) {
      console.log(`${ANSI_COLORS.CYAN}  PORTAFOLIO LOCAL${ANSI_COLORS.RESET}`);
      balance.coins.forEach((c, i) => {
        const prefix = i === balance.coins!.length - 1 ? '└─' : '├─';
        console.log(`${ANSI_COLORS.GRAY}  ${prefix} ${c.symbol.padEnd(6)}: ${ANSI_COLORS.GREEN}${c.balance}${ANSI_COLORS.RESET}`);
      });
    }

    if (positions.length > 0) {
      console.log(`${ANSI_COLORS.CYAN}  POSICIONES ABIERTAS (IOL)${ANSI_COLORS.RESET}`);
      positions.forEach((p, i) => {
        const prefix = i === positions.length - 1 ? '└─' : '├─';
        const pnlCol = p.unrealizedPl >= 0 ? ANSI_COLORS.GREEN : ANSI_COLORS.RED;
        const mktVal = p.marketValue ? `$${p.marketValue.toFixed(2)}` : 'N/A';
        console.log(`${ANSI_COLORS.GRAY}  ${prefix} ${p.symbol.padEnd(6)} | Qty: ${p.qty} | Precio: $${p.currentPrice?.toFixed(2) || 0} | Valor: ${mktVal} | PnL: ${pnlCol}$${p.unrealizedPl?.toFixed(2) || 0} (${((p.unrealizedPlPc || 0) * 100).toFixed(2)}%)${ANSI_COLORS.RESET}`);
      });
    }

    if (pnlPercentage <= SYSTEM_THRESHOLDS.DAMAGE_CONTROL_PNL) {
      isDamageControl = true;
    }

    if (isDamageControl) {
      currentState = 'DAMAGE_CONTROL';
      marketContext = DAMAGE_CONTROL_MANDATE;
    } else if (iterationCount === 1 || iterationCount % 5 === 0) {
      currentState = 'PORTFOLIO_AUDIT';
      marketContext = MARKET_STATES.PORTFOLIO_AUDIT;
    } else {
      const { bymaOpen } = getBymaMarketStatus();
      currentState = bymaOpen ? 'MARKET_OPEN' : 'RESEARCH_MODE';
      marketContext = bymaOpen ? MARKET_STATES.MARKET_OPEN : MARKET_STATES.RESEARCH_MODE;
    }

    marketContext += `\n\n**ESTADO DE TU BILLETERA REAL EN IOL:**\n`;
    marketContext += `- Poder Spot Disponible (Liquidez Real para Operar): ${availableSpot.toFixed(2)}\n`;

    if (!octavioState.active) {
      marketContext += `\n⚠️ Octavio (Especialista en Opciones) está APAGADO. Puedes usar 'command_octavio' para activarlo.\n`;
    }

    marketContext += `\n\n**Reporte de Richard Newman (Macro/Noticias Locales):**\n${cachedResearchReport}`;

    if (octavioState.active) {
      const octavioReport = await MissionService.getOctavioReport();
      if (octavioReport && octavioReport !== "Sin reportes recientes. Esperando órdenes.") {
        marketContext += `\n\n**MENSAJE URGENTE DE OCTAVIO (Opciones):**\n${octavioReport}`;
        await MissionService.setOctavioReport("Sin reportes recientes. Esperando órdenes.");
      }
    }

    let agentPrompt = isDamageControl
      ? `ESTÁS EN MODO DAMAGE CONTROL. Revisa tus posiciones en IOL.`
      : (currentState === 'PORTFOLIO_AUDIT'
        ? `ESTÁS EN AUDITORÍA DE PORTAFOLIO. Evalúa tus posiciones locales (BYMA). CIERRA si la tesis falló.`
        : `Analiza los reportes macroeconómicos de Argentina y tus posiciones locales. Toma decisiones QUIRÚRGICAS.`);

    const isTradingEnabled = process.env.IOL_ENABLE_TRADING === 'true';
    if (!isTradingEnabled) {
      agentPrompt += `\n\nATENCIÓN: EL SISTEMA ESTÁ EN MODO READ-ONLY (SEGURIDAD MÁXIMA). ERES UN ASESOR/AUDITOR, NO UN TRADER. TIENES PROHIBIDO EJECUTAR ÓRDENES. TU ÚNICO OBJETIVO ES ANALIZAR LA CARTERA Y AVISAR AL USUARIO SI SE ESTÁ PERDIENDO UNA OPORTUNIDAD O SI HAY UN RIESGO. DA TU REPORTE COMO RAZONAMIENTO PURO Y TERMINA CON [TÍTULO: Resumen de tu análisis]. NO INTENTES INVOCAR HERRAMIENTAS DE TRADING NI USAR JSON.`;
    } else {
      agentPrompt += ` REGLA ESTRICTA: SOLO estás autorizado a operar en IOL.\n\nREGLA CRÍTICA PARA HERRAMIENTAS: Si decides invocar una herramienta, TIENES PROHIBIDO escribir cualquier texto, razonamiento o explicación. Debes emitir ÚNICAMENTE el bloque JSON. Si decides NO usar herramientas, genera tu razonamiento interno y utiliza [TÍTULO: Resumen de tu decisión] al final.`;
    }

    const agentResponse = await runAgentCycle(agentPrompt, marketContext);
    let finalContent = typeof agentResponse === 'string' ? agentResponse : (agentResponse?.content || '');

    const titleMatch = finalContent.match(/\[T[IÍ]TULO:([^\]]+)\]/i);
    if (titleMatch) {
      console.log(`${LOG_PREFIX.AUDITORIA} ${titleMatch[1].trim()}${ANSI_COLORS.RESET}`);
    } else {
      console.log(`${LOG_PREFIX.AUDITORIA} Ciclo completado sin acciones.${ANSI_COLORS.RESET}`);
    }

  } catch (error: any) {
    console.error(`${LOG_PREFIX.SISTEMA} ${ANSI_COLORS.RED}Error en ciclo IOL: ${error.message}${ANSI_COLORS.RESET}`);
  }
}

async function startIolDaemon(initialIntervalSeconds = 60) {
  const asciiIol = `${ANSI_COLORS.MAGENTA}${ANSI_COLORS.BOLD}
  ___  ___  _       ____  _____  ___      _    ___ 
 |_ _|/ _ \\| |     / ___|| ____|/ _ \\    / \\  |_ _|
  | || | | | |    | |    |  _| | | | |  / _ \\  | | 
  | || |_| | |___ | |___ | |___| |_| | / ___ \\ | | 
 |___|\\___/|_____| \\____||_____|\\___/ /_/   \\_\\___|
 API REST V2 invertironline
  \x1b[0m`;

  const isTradingEnabled = process.env.IOL_ENABLE_TRADING === 'true';
  const readOnlyText = !isTradingEnabled ? "🟢 TRUE (Seguridad Máxima)" : "🔴 FALSE (Trading Habilitado)";
  
  // Variables Dinámicas para la configuración
  const now = DateTime.now().setZone('America/Argentina/Buenos_Aires');
  const isWeekend = now.weekday >= 6;
  const isBymaOpen = !isWeekend && now.hour >= 11 && now.hour < 17;
  
  const marketName = "BYMA";
  const marketStatus = isBymaOpen ? "🟢 ABIERTO / CONECTADO" : "🔴 CERRADO (Fuera de horario)";
  const protocolName = venueRegistry.iol?.protocol || "Protocolo Desconocido";
  const isOctavioEnabled = process.env.OCTAVIO_ENABLED !== 'false';
  const activeAgents = `CEO Trader${isOctavioEnabled ? ' & Octavio (Opciones)' : ''}`;

  const modeTitle = `${asciiIol}\n` +
    `  Investment CEO AI (Modo: BYMA / IOL) \n\n` +
    `────────────────────────────────────────────────────────────────────────\n` +
    `  CONFIGURACIÓN DE MODO IOL\n` +
    `────────────────────────────────────────────────────────────────────────\n` +
    `  Mercado Tradicional (${marketName})   : ${marketStatus}\n` +
    `  Mode: Read-Only              : ${readOnlyText}\n` +
    `  Protocolo                    : ${protocolName}\n` +
    `  Agentes Activos              : ${activeAgents}\n` +
    `────────────────────────────────────────────────────────────────────────\n`;

  console.log(modeTitle);

  if (isOctavioEnabled) {
    const octavioAssets = process.env.OCTAVIO_ASSETS || 'ALL';
    // En modo IOL (Asesor), Octavio no necesita presupuesto ni target. Rotará sobre la lista de activos o leerá todo el mercado si es 'ALL'.
    StateService.setOctavioConfig(true, octavioAssets, 0, 0, true);
  }

  const hasToken = !!process.env.IOL_ACCESS_TOKEN;
  if (!hasToken) {
    if (!process.env.IOL_USERNAME) {
      process.env.IOL_USERNAME = await promptNormal(`${ANSI_COLORS.YELLOW}Ingresa tu Usuario de InvertirOnline: ${ANSI_COLORS.RESET}`);
    }
    if (!process.env.IOL_PASSWORD) {
      process.env.IOL_PASSWORD = await promptHidden(`${ANSI_COLORS.YELLOW}Ingresa tu Contraseña de InvertirOnline: ${ANSI_COLORS.RESET}`);
      console.log();
    }
    if (!process.env.IOL_USERNAME || !process.env.IOL_PASSWORD) {
      console.error(`\n${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🛑 ERROR FATAL: FALTAN CREDENCIALES 🛑${ANSI_COLORS.RESET}`);
      process.exit(1);
    }
    
    console.log(`\n${LOG_PREFIX.SISTEMA} Validando credenciales con InvertirOnline...`);
    const token = await getIolAccessToken();
    if (!token) {
      console.error(`\n${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🛑 ERROR FATAL: LA AUTENTICACIÓN HA FALLADO 🛑${ANSI_COLORS.RESET}`);
      console.error(`${ANSI_COLORS.RED}Tus credenciales de InvertirOnline fueron rechazadas o la API no está disponible.${ANSI_COLORS.RESET}`);
      console.error(`${ANSI_COLORS.RED}El sistema se detendrá por seguridad. Verifica tu usuario y contraseña.\n${ANSI_COLORS.RESET}`);
      process.exit(1);
    }
  }

  ModelRouter.printRegistryTable();

  while (true) {
    await runIolIteration();
    const { bymaOpen } = getBymaMarketStatus();
    const currentInterval = bymaOpen ? SYSTEM_INTERVALS.CEO_PEAK_SEC : SYSTEM_INTERVALS.CEO_BASE_SEC;

    console.log(`\n${LOG_PREFIX.SISTEMA} ⏳ El CEO entró en espera por ${currentInterval} segundos...`);
    const octavioStateLocal = StateService.getOctavioState();
    if (!octavioStateLocal.active) {
      console.log(`${LOG_PREFIX.OCTAVIO} Mantenimiento en progreso (APAGADO).\n`);
    }
    await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));
  }
}

if (require.main === module) {
  startOctavioDaemon().catch(console.error);
  startIolDaemon(SYSTEM_INTERVALS.CEO_BASE_SEC).catch(console.error);
}
