import { startScrappyDaemon } from './scrappy.loop';
import { StateService } from '@/features/agent/services/state.service';
import { ANSI_COLORS } from '@/shared/constants/colors';

// Activar Scrappy forzadamente para el modo standalone
StateService.setScrappyConfig(true, 'BTCUSDT', 200, 20);

const scrappyAscii = `${ANSI_COLORS.MAGENTA}${ANSI_COLORS.BOLD}
      .
     / V\\
   / \`  /
  <<   |
  /    |
/      |
\\_ __ /

  ____                                
 / ___|  ___ _ __ __ _ _ __  _ __  _   _ 
 \\___ \\ / __| '__/ _\` | '_ \\| '_ \\| | | |
  ___) | (__| | | (_| | |_) | |_) | |_| |
 |____/ \\___|_|  \\__,_| .__/| .__/ \\__, |
                      |_|   |_|    |___/ 
${ANSI_COLORS.RESET}`;

const config = StateService.getScrappyState();

console.log(scrappyAscii);
console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
console.log(`${ANSI_COLORS.BOLD}  SCRAPPY HFT (Modo Standalone)${ANSI_COLORS.RESET}`);
console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
console.log(`  Activo Base   : ${config.targetAsset}`);
console.log(`  Presupuesto   : $${config.budget}`);
console.log(`  Meta (Target) : $${config.target}`);
console.log(`  Directiva     : Scalping Algorítmico Agresivo`);
console.log(`${ANSI_COLORS.MAGENTA}────────────────────────────────────────────────────────────────────────\n${ANSI_COLORS.RESET}`);

startScrappyDaemon().catch(console.error);
