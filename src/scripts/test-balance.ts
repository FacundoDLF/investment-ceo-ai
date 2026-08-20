import { runAgentCycle } from '../features/agent/services/agent.service';
import { loadEnvConfig } from '@next/env';

// Load environment variables
const projectDir = process.cwd();
loadEnvConfig(projectDir);

async function testBalance() {
  const prompt = "Revisa cuánto dinero hay disponible en la cuenta de Alpaca";
  console.log(`\n🤖 Iniciando prueba del Agente CEO con el prompt: "${prompt}"...\n`);
  
  try {
    const result = await runAgentCycle(prompt);
    console.log(`\n✅ Resultado del Agente CEO:`);
    console.dir(result, { depth: null, colors: true });
  } catch (error) {
    console.error('\n❌ Error al ejecutar el agente:', error);
  }
}

testBalance();
