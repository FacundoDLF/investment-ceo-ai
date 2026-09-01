import { startOctavioDaemon } from './octavio.loop';
import { StateService } from '@/features/agent/services/state.service';

// Activar Octavio forzadamente para el modo standalone
StateService.setOctavioConfig(true, 'BTCUSDT', 200, 20);

console.log("Iniciando Octavio en modo Standalone...");
startOctavioDaemon().catch(console.error);
