import { StateService } from '@/features/agent/services/state.service';
import { MissionService } from '@/features/agent/services/mission.service';
import { getUnifiedBalance } from '@/features/venues/venue.service';
import { runScrappyIteration } from '@/features/agent/sub-agents/scrappy.agent';
import { ANSI_COLORS } from '@/shared/constants/colors';

// Configuración inicial base
StateService.setScrappyConfig(true, 'BTCUSDT', 0, 0, false);

const scrappyAscii = `${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}
                                                       _____
                                                     /'     \`\\
  __                                            ___/'         \`\\
/'  \`\\_                          _            /'                \\
       \\________________________( )_________/'                   \`\\_______
                             _  | |                _
          _                 ( \\ |  )  _           ( ) _
       _ ( )                 \\ \`|  | ( )         _| |/ )
      ( \\| | _                \`\\,  |/'/'        ( \\  /'
       \\,. |/ )                 |   /'           \\  |
         |  /'                  |  |              | |
         | |                                      | |
${ANSI_COLORS.PINK}                 ____  ____ ____      _    ____  ____ __   __
                / ___|/ ___|  _ \\    / \\  |  _ \\|  _ \\\\ \\ / /
                \\___ \\ |   | |_) |  / _ \\ | |_) | |_) |\\ V / 
                 ___) | |__|  _ <  / ___ \\|  __/|  __/  | |  
                |____/\\____|_| \\_\\/_/   \\_\\_|   |_|     |_|  
${ANSI_COLORS.RESET}`;

const config = StateService.getScrappyState();

function getTierTarget(budget: number, tier: number): number {
  if (tier === 1) return budget * 0.05;
  if (tier === 2) return budget * 0.10;
  if (tier === 3) return budget * 0.15;
  // Tier 4 = 20%, Tier 5 = 30%...
  return budget * ((tier - 4) * 0.10 + 0.20);
}

async function startDynamicStandalone() {
  let standaloneTier = 1;
  let standaloneBudget = 0;
  let currentTarget = 0;

  const initCycle = async () => {
    const balance = await getUnifiedBalance('bybit');
    standaloneBudget = balance.cash * 0.5;
    standaloneTier = 1;
    currentTarget = getTierTarget(standaloneBudget, standaloneTier);
    StateService.setScrappyConfig(true, 'BTCUSDT', standaloneBudget, currentTarget, false);
    
    console.log(scrappyAscii);
    console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.BOLD}  SCRAPPY HFT (Modo Standalone Dinámico)${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
    console.log(`  Capital ByBit : $${balance.cash.toFixed(2)}`);
    console.log(`  Presupuesto   : $${standaloneBudget.toFixed(2)} (50%)`);
    console.log(`  Meta Tier 1   : $${currentTarget.toFixed(2)} (5%)`);
    console.log(`  Directiva     : Scalping Algorítmico Agresivo`);
    console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────\n${ANSI_COLORS.RESET}`);
  };

  await initCycle();
  console.log(`${ANSI_COLORS.YELLOW}[Sistema] Iniciando demonio dinámico de Scrappy...${ANSI_COLORS.RESET}`);

  while (true) {
    try {
      await runScrappyIteration();
      
      const currentPnL = await MissionService.getScrappyPnL();
      if (currentPnL >= currentTarget) {
        const maxTarget = standaloneBudget;
        if (currentTarget >= maxTarget || currentPnL >= maxTarget) {
          console.log(`\n${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}🎉 [STANDALONE] ¡ALCANCÍA LLENA AL 100%!🎉`);
          console.log(`Scrappy ha duplicado su presupuesto ganando $${currentPnL.toFixed(2)}.`);
          console.log(`Depositando ganancias y reiniciando ciclo con nuevo presupuesto...${ANSI_COLORS.RESET}\n`);
          await MissionService.resetScrappyPnL();
          await initCycle();
        } else {
          standaloneTier++;
          currentTarget = getTierTarget(standaloneBudget, standaloneTier);
          StateService.setScrappyConfig(true, 'BTCUSDT', standaloneBudget, currentTarget, false);
          console.log(`\n${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}🚀 [STANDALONE] ¡Tier completado! Subiendo a Tier ${standaloneTier}... Nueva Meta: $${currentTarget.toFixed(2)}${ANSI_COLORS.RESET}\n`);
        }
      }
    } catch (error: any) {
      // Ignore silence errors
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

startDynamicStandalone().catch(console.error);
