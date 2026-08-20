import { NextResponse } from 'next/server';
import { runAgentCycle } from '@/features/agent/services/agent.service';

export async function GET() {
  try {
    const prompt = "Revisa cuánto dinero hay disponible en la cuenta de Alpaca";
    console.log(`\n🤖 Iniciando prueba del Agente CEO con el prompt: "${prompt}"...`);
    
    const result = await runAgentCycle(prompt);
    
    console.log(`✅ Resultado del Agente CEO:`);
    console.dir(result, { depth: null, colors: true });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('❌ Error in agent test route:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error executing agent' },
      { status: 500 }
    );
  }
}
