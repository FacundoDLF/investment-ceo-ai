import { prisma } from './src/shared/lib/prisma';

async function main() {
  console.log("=== ÚLTIMOS LOGS DE SCRAPPY Y OCTAVIO ===");
  
  const ceoMemories = await prisma.ceoMemory.findMany({
    where: { key: { contains: 'PNL' } }
  });
  console.log("Alcancías (PnL):", JSON.stringify(ceoMemories, null, 2));

  const executions = await prisma.executionLog.findMany({
    take: 50,
    orderBy: { timestamp: 'desc' }
  });
  console.log("Últimas 50 ejecuciones:");
  for (const ex of executions) {
    console.log(`[${ex.timestamp.toISOString()}] ${ex.eventType} | Venue: ${ex.venue} | Symbol: ${ex.symbol} | Success: ${ex.success} | Details: ${ex.details}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
