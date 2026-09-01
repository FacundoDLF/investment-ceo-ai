import { startScrappyDaemon } from './scrappy.loop';
import { StateService } from '@/features/agent/services/state.service';

// Activar Scrappy forzadamente para el modo standalone
StateService.setScrappyConfig(true, 'BTCUSDT', 200, 20);

console.log("Iniciando Scrappy en modo Standalone...");
startScrappyDaemon().catch(console.error);
