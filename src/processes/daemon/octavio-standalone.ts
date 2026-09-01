import { startOctavioDaemon } from './octavio.loop';
import { StateService } from '@/features/agent/services/state.service';
import { ANSI_COLORS } from '@/shared/constants/colors';

// Activar Octavio forzadamente para el modo standalone
StateService.setOctavioConfig(true, 'BTCUSDT', 200, 20);

const octavioAscii = `${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}
    ,---.
   ( @ @ )
    ).-.(
   '/|||\\'\`
     '|'\`

   ___      _             _       
  / _ \\ ___| |_ __ ___ _ (_) ___  
 | | | / __| __/ _\` \\ \\ / / |/ _ \\ 
 | |_| \\__ \\ || (_| |\\ V /| | (_) |
  \\___/|___/\\__\\__,_| \\_/ |_|\\___/ 
${ANSI_COLORS.RESET}`;

const config = StateService.getOctavioState();

console.log(octavioAscii);
console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
console.log(`${ANSI_COLORS.BOLD}  🐙 OCTAVIO HFT OPTIONS (Modo Standalone)${ANSI_COLORS.RESET}`);
console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
console.log(`  Activo Base   : ${config.targetAsset}`);
console.log(`  Presupuesto   : $${config.budget}`);
console.log(`  Meta (Target) : $${config.target}`);
console.log(`  Directiva     : Análisis de Griegas y Caza de Primas`);
console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────\n${ANSI_COLORS.RESET}`);

startOctavioDaemon().catch(console.error);
