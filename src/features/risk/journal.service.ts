import { prisma } from '@/shared/lib/prisma';

export interface ExecutionLogData {
  eventType: string;
  venue?: string | null;
  symbol?: string | null;
  details: any;
  success?: boolean;
}

export async function logExecution(data: ExecutionLogData): Promise<void> {
  try {
    await prisma.executionLog.create({
      data: {
        eventType: data.eventType,
        venue: data.venue,
        symbol: data.symbol,
        details: JSON.stringify(data.details),
        success: data.success ?? true,
      },
    });
  } catch (error) {
  }
}
