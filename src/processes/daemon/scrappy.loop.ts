import { runScrappyIteration } from '@/features/agent/sub-agents/scrappy.agent';
import { LOG_PREFIX } from '@/shared/constants/colors';

export async function startScrappyDaemon() {
  console.log(`${LOG_PREFIX.SISTEMA} Iniciando demonio de Scrappy (Scalper HFT)...`);
  
  // Bucle infinito silencioso
  while (true) {
    try {
      await runScrappyIteration();
    } catch (error) {
      // Ignorar errores para no spamear la consola
    }
    // Esperar 3 segundos entre iteraciones para no saturar la API
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
