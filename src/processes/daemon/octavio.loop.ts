import { runOctavioIteration } from '@/features/agent/sub-agents/octavio.agent';
import { LOG_PREFIX } from '@/shared/constants/colors';

export async function startOctavioDaemon() {
  console.log(`${LOG_PREFIX.SISTEMA} Iniciando demonio de Octavio (Opciones HFT)...`);
  
  // Bucle infinito silencioso
  while (true) {
    let shouldWait = true;
    try {
      shouldWait = await runOctavioIteration();
    } catch (error) {
      // Ignorar errores para no spamear la consola
    }
    // Esperar 5 segundos entre iteraciones para no saturar la API
    if (shouldWait !== false) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
