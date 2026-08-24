import { runAgentCycle } from '../../features/agent/services/agent.service';

async function main() {
  const args = process.argv.slice(2).join(' ');
  if (!args) {
    console.log("Uso: npm run chat \"Tu mensaje para el CEO\"");
    process.exit(1);
  }
  
  console.log(`\n🗣️ Tú: ${args}\n`);
  const response = await runAgentCycle(args);
  console.log(`\n🤖 CEO: ${response}\n`);
}

main().catch(console.error);
