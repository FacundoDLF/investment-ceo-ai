import { startScrappyDaemon } from './scrappy.loop';
import { StateService } from '@/features/agent/services/state.service';
import { ANSI_COLORS } from '@/shared/constants/colors';

// Activar Scrappy forzadamente para el modo standalone
StateService.setScrappyConfig(true, 'BTCUSDT', 200, 20);

const scrappyAscii = `${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}
         _
       _|_|_
      |     |
      |     |
   _  |     |  _
  | | |     | | |
  | | |     | | |
  \\_| |     | |_/
      |     |
      |_____|

${ANSI_COLORS.PINK}  ____  ____ ____      _    ____  ____ __   __
 / ___|/ ___|  _ \\    / \\  |  _ \\|  _ \\\\ \\ / /
 \\___ \\ |   | |_) |  / _ \\ | |_) | |_) |\\ V / 
  ___) | |__|  _ <  / ___ \\|  __/|  __/  | |  
 |____/\\____|_| \\_\\/_/   \\_\\_|   |_|     |_|  
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
