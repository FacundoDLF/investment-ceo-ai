-- CreateEnum
CREATE TYPE "StrategyType" AS ENUM ('LONG_TERM', 'INTRADAY');

-- AlterTable
ALTER TABLE "ExecutionLog" ADD COLUMN     "strategy" "StrategyType" NOT NULL DEFAULT 'LONG_TERM';

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "strategy" "StrategyType" NOT NULL DEFAULT 'LONG_TERM',
    "thesis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalEquity" DOUBLE PRECISION NOT NULL,
    "unrealizedPnL" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_venue_symbol_key" ON "Position"("venue", "symbol");
