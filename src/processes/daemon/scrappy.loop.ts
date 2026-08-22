import { runScrappyIteration } from '@/features/agent/sub-agents/scrappy.agent';

export async function startScrappyDaemon() {
  console.log('\x1b[35m[Sistema]\x1b[0m Iniciando demonio de Scrappy (Scalper HFT)...');
  
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
