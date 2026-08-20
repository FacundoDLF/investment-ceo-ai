import { NextResponse } from 'next/server';
import { runAgentCycle } from '@/features/agent/services/agent.service';

export async function GET() {
  try {
    const result = await runAgentCycle("Despierta y evalúa tu estado financiero");
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error in agent test route:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error executing agent' },
      { status: 500 }
    );
  }
}
