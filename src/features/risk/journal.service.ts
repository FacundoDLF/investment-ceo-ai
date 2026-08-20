import { PrismaClient } from '@/generated/prisma';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const connectionString = process.env.DATABASE_URL?.replace('file:', '') || './dev.db';
const adapter = new PrismaBetterSqlite3({ url: connectionString });
const prisma = new PrismaClient({ adapter });

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
