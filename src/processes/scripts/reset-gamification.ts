import { prisma } from '../../shared/lib/prisma';

async function main() {
  await prisma.ceoMemory.deleteMany({
    where: {
      key: {
        in: [
          'ACTIVE_TIER_alpaca', 'FROZEN_RESERVE_alpaca', 'CYCLE_STEP_alpaca', 'WORKING_CAPITAL_alpaca', 'CURRENT_TARGET_alpaca',
          'ACTIVE_TIER_bybit', 'FROZEN_RESERVE_bybit', 'CYCLE_STEP_bybit', 'WORKING_CAPITAL_bybit', 'CURRENT_TARGET_bybit'
        ]
      }
    }
  });
  console.log("Gamification state reset. Next tick will auto-generate everything perfectly.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
