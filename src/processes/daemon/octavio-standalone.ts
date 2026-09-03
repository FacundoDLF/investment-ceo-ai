import { StateService } from '@/features/agent/services/state.service';
import { MissionService } from '@/features/agent/services/mission.service';
import { getUnifiedBalance } from '@/features/venues/venue.service';
import { runOctavioIteration } from '@/features/agent/sub-agents/octavio.agent';
import { ANSI_COLORS } from '@/shared/constants/colors';

const DAEMON_START_TIME = Date.now();
function formatUptime(): string {
  const diff = Math.floor((Date.now() - DAEMON_START_TIME) / 1000);
  const d = Math.floor(diff / (3600 * 24));
  const h = Math.floor((diff % (3600 * 24)) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

// Configuración inicial base (Rotación masiva de opciones ByBit + Alpaca)
StateService.setOctavioConfig(true, 'SPX,VIX,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,MNTUSDT,XAUTUSDT,HYPEUSDT', 0, 0, false);

const octavioAscii = `${ANSI_COLORS.LIME_GREEN}${ANSI_COLORS.BOLD}
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠢⠀⠀⠀⡑⢄⠀⠁⠀⠑⢄⠙⢦⡀⠢⠙⡦⣈⢧⡻⣜⠼⣜⢯⣿⣿⣿⣿⣿⣿⣿⣿⣼⣹⢣⢣⢡⠞⣁⣴⠞⡁⠀⠀⠀⡠⠀⠀⠤⠀⠀⠀⠀⠀⡠
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠑⠠⡈⠒⠥⣀⠀⠐⠄⡉⠢⣝⡲⢬⡪⣎⢧⠽⠟⡺⠿⠛⠋⠉⠉⠉⠉⠉⠙⠛⠛⠿⣟⡻⢷⣾⣫⠥⡺⠕⣀⠤⡊⠀⢠⠀⢀⡠⠂⢀⡠⠊
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠀⠀⠀⠀⠒⠤⣀⠑⠢⠬⣽⣒⠤⠈⠒⡦⢭⣟⠚⣩⠰⠊⠁⠀⠀⠀⢀⡀⡀⠀⠀⠀⠀⠀⠀⢀⠀⠉⠓⢮⣝⡳⢻⣭⠖⣋⠠⣀⡴⠞⡩⠄⠚⠁⠀⠀⠄
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⢀⡀⠈⠀⠀⠀⠈⠁⠒⠀⠬⠍⠛⠛⣚⣩⡆⠋⠁⣀⣴⣶⠏⣠⡞⣡⣶⣶⣶⡄⠀⠀⠀⠀⠀⠻⣷⣦⣀⠈⠛⢶⣬⣓⣒⢛⣃⣉⠠⠔⠀⠠⠂⠁⠀⠀⠀⠠
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠂⠠⠀⠀⠀⠈⠁⠐⠢⠤⣁⣒⣒⣛⣂⣶⡟⠟⠉⢀⣤⣾⣿⣿⡏⢠⢶⡃⢿⣿⣿⠿⠁⠀⠀⠀⠀⠀⠀⢹⣿⣿⣷⣤⠀⠈⠻⢯⣟⣂⣂⣒⣒⣒⣈⡩⠥⠐⠈⠁⠀⠀⠠⠀⠈⠉⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠀⠀⠀⠈⠉⠉⠉⠀⠐⠒⣒⣛⣿⣿⣛⠉⠀⠀⠠⣾⣿⣿⣿⣿⡅⢊⠎⣹⠀⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣷⠀⠀⠀⠉⣛⠒⢲⠆⠡⠤⠤⠤⠒⠒⠀⠈⠀⠀⠀⠀⠀⢀⡀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀⠈⠀⡀⠠⠤⠐⠒⠒⣒⠒⠚⠳⠼⠛⠿⣶⣥⡠⡀⠙⢿⣿⣿⣿⣇⠀⠘⠄⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣮⣿⣿⣿⠟⠃⠀⢀⣴⣶⠿⠛⢿⣽⣛⠋⣉⣉⠉⠒⠒⠒⠂⠐⠀⠉
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⠀⠒⠀⠩⠉⠀⠉⠉⢑⡚⢛⢋⠸⠝⠿⣮⣔⠄⡈⠛⠿⣿⣄⠈⠀⠁⠂⠄⠀⠀⠀⠀⠀⠀⢀⣼⣿⠿⠛⢁⢀⣠⣾⡻⠯⠭⣉⡙⠓⠚⠥⢄⡀⠀⠀⠈⠉⠐⠒
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠀⠤⠄⠀⠤⠐⠀⠈⢉⡠⠄⣀⠤⠒⣈⡭⠾⢙⡿⣾⣤⣂⠀⣉⠑⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⠊⣉⠠⣀⣬⡶⢿⣟⠯⢍⡛⠶⡤⠉⠑⠢⢄⠀⠀⠉⠀⠂⠠
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠒⡡⠔⠈⠀⠢⠋⠁⠂⠀⣡⠴⢃⣵⢟⡟⣷⣾⣿⣶⣶⣤⣤⣤⣴⣶⣦⣬⡷⣶⢿⢯⡳⣌⠢⢍⠛⠦⠌⠑⠠⠀⠀⠲⠤⡉⠢⠀⠈⠀⡀
${ANSI_COLORS.CYAN}                                                
                                ___   ____ _____  _  __     __ ___  ___  
                               / _ \\ / ___|_   _|/ \\ \\ \\   / /|_ _|/ _ \\ 
                              | | | | |     | | / _ \\ \\ \\ / /  | || | | |
                              | |_| | |___  | |/ ___ \\ \\ V /   | || |_| |
                               \\___/ \\____| |_/_/   \\_\\ \\_/   |___|\\___/ ${ANSI_COLORS.RESET}`;

const config = StateService.getOctavioState();

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
    const bybitBal = await getUnifiedBalance('bybit');
    const alpacaBal = await getUnifiedBalance('alpaca');
    
    const bybitBudget = bybitBal.cash * 0.4;
    const alpacaBudget = alpacaBal.cash * 0.4;
    standaloneBudget = bybitBudget + alpacaBudget;
    
    standaloneTier = 1;
    currentTarget = getTierTarget(standaloneBudget, standaloneTier);
    StateService.setOctavioConfig(true, 'SPX,VIX,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,MNTUSDT,XAUTUSDT,HYPEUSDT', standaloneBudget, currentTarget, false);
    
    console.log(octavioAscii);
    console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.BOLD}  OCTAVIO HFT OPTIONS (Modo Standalone Multi-Venue)${ANSI_COLORS.RESET}`);
    console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────${ANSI_COLORS.RESET}`);
    console.log(`  Capital ByBit : $${bybitBal.cash.toFixed(2)} (Bdg: $${bybitBudget.toFixed(2)})`);
    console.log(`  Capital Alpaca: $${alpacaBal.cash.toFixed(2)} (Bdg: $${alpacaBudget.toFixed(2)})`);
    console.log(`  Presupuesto Total: $${standaloneBudget.toFixed(2)}`);
    console.log(`  Meta Tier 1   : $${currentTarget.toFixed(2)} (5%)`);
    console.log(`  Target Assets : ROTACIÓN MASIVA (10 Índices/Monedas)`);
    console.log(`  Directiva     : Análisis de Griegas y Caza de Primas`);
    console.log(`${ANSI_COLORS.CYAN}────────────────────────────────────────────────────────────────────────\n${ANSI_COLORS.RESET}`);
  };

  await initCycle();
  console.log(`${ANSI_COLORS.YELLOW}[Sistema] Iniciando demonio dinámico de Octavio...${ANSI_COLORS.RESET}`);

  let iter = 1;
  while (true) {
    try {
      console.log(`\n${ANSI_COLORS.GRAY}[${new Date().toLocaleTimeString()}] [Octavio] Iteración #${iter} | Running: ${formatUptime()}...${ANSI_COLORS.RESET}`);
      await runOctavioIteration();
      iter++;
      
      const currentPnL = await MissionService.getOctavioPnL();
      if (currentPnL >= currentTarget) {
        const maxTarget = standaloneBudget;
        if (currentTarget >= maxTarget || currentPnL >= maxTarget) {
          console.log(`\n${ANSI_COLORS.GREEN}${ANSI_COLORS.BOLD}🎉 [STANDALONE] ¡ALCANCÍA LLENA AL 100%!🎉`);
          console.log(`Octavio ha duplicado su presupuesto ganando $${currentPnL.toFixed(2)}.`);
          console.log(`Depositando ganancias y reiniciando ciclo con nuevo presupuesto...${ANSI_COLORS.RESET}\n`);
          await MissionService.resetOctavioPnL();
          await initCycle();
        } else {
          standaloneTier++;
          currentTarget = getTierTarget(standaloneBudget, standaloneTier);
          StateService.setOctavioConfig(true, 'SPX,VIX,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,MNTUSDT,XAUTUSDT,HYPEUSDT', standaloneBudget, currentTarget, false);
          console.log(`\n${ANSI_COLORS.CYAN}${ANSI_COLORS.BOLD}🚀 [STANDALONE] ¡Tier completado! Subiendo a Tier ${standaloneTier}... Nueva Meta: $${currentTarget.toFixed(2)}${ANSI_COLORS.RESET}\n`);
        }
      }
    } catch (error: any) {
      // Ignore silence errors
    }
    await new Promise(resolve => setTimeout(resolve, 5000)); // Octavio rota cada 5s
  }
}

startDynamicStandalone().catch(console.error);
