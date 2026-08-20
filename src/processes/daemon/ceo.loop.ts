import { DateTime } from 'luxon';
import { runAgentCycle } from '@/features/agent/services/agent.service';
import { MARKET_STATES } from '@/features/agent/config/ceo.mandate';
import { runResearchAgent } from '@/features/agent/sub-agents/research.agent';
import { runQuantAgent } from '@/features/agent/sub-agents/quant.agent';
import { prisma } from '@/shared/lib/prisma';

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

async function runDaemonIteration() {
  console.log(`\n[${new Date().toISOString()}] Iniciando iteración del CEO Daemon...`);
  
  try {
    const { bymaOpen, wsPreMarket, wsOpen, wsAfterHours } = getMarketStatus();

    let currentState = 'RESEARCH_MODE';
    let marketContext = MARKET_STATES.RESEARCH_MODE;

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

    console.log(`Estado actual de mercados detectado: ${currentState}`);

    if (currentState !== 'RESEARCH_MODE') {
      const latestInsight = await prisma.marketInsight.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (latestInsight) {
        marketContext += `\n\n**Último Análisis de Fin de Semana (Market Insight):**\nContexto: ${latestInsight.context}\nSeveridad: ${latestInsight.severity}\nAcción Deducida: ${latestInsight.deducedAction}`;
      }
    }

    console.log('[CEO Daemon] Consultando a Sub-Agentes en paralelo...');
    
    // Ejecutar sub-agentes en paralelo
    const [researchReport, quantReport] = await Promise.all([
      runResearchAgent('Resumen macroeconómico y eventos clave del día.'),
      runQuantAgent('SPY') // Por defecto analizamos un activo de referencia o el portafolio
    ]);

    console.log('[CEO Daemon] Reportes de Sub-Agentes recibidos.');
    
    // Inyectar reportes al contexto del CEO
    marketContext += `\n\n**Reporte del Research Agent:**\n${researchReport}`;
    marketContext += `\n\n**Reporte del Quant Agent:**\n${quantReport}`;

    const agentResponse = await runAgentCycle(
      'Analiza los reportes de tus sub-agentes, el estado del mercado actual y ejecuta operaciones si es necesario basado en tus conclusiones.',
      marketContext
    );

    console.log('[Agente CEO] Respuesta obtenida:');
    if (agentResponse && typeof agentResponse === 'object' && 'content' in agentResponse) {
       console.log(agentResponse.content);
    } else {
       console.log(agentResponse);
    }

  } catch (error) {
    console.error('Error en la iteración del daemon:', error);
  }
}

export async function startCeoDaemon(intervalMinutes = 1) {
  console.log(`Arrancando CEO Daemon (Intervalo: ${intervalMinutes} minutos)...`);
  
  while (true) {
    await runDaemonIteration();
    console.log(`Durmiendo por ${intervalMinutes} minutos...`);
    await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
  }
}

if (require.main === module) {
  startCeoDaemon(1).catch(console.error);
}
