import { prisma } from '@/shared/lib/prisma';
import { VenueName } from '@/features/venues/venue.service';

export class MissionService {
  
  static readonly TIER_PERCENTAGES = [0.05, 0.10, 0.15, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];
  static readonly SALARY_RESERVE = 4500;

  static async getFrozenReserve(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `FROZEN_RESERVE_${venue}` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async setFrozenReserve(venue: VenueName, amount: number): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `FROZEN_RESERVE_${venue}` },
      update: { value: amount.toString() },
      create: { key: `FROZEN_RESERVE_${venue}`, value: amount.toString() }
    });
  }

  static async getActiveTier(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `ACTIVE_TIER_${venue}` } });
    return mem ? parseInt(mem.value) : 1;
  }

  static async setActiveTier(venue: VenueName, tier: number): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `ACTIVE_TIER_${venue}` },
      update: { value: tier.toString() },
      create: { key: `ACTIVE_TIER_${venue}`, value: tier.toString() }
    });
  }

  static async getCycleStep(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `CYCLE_STEP_${venue}` } });
    return mem ? parseInt(mem.value) : 0;
  }

  static async setCycleStep(venue: VenueName, step: number): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `CYCLE_STEP_${venue}` },
      update: { value: step.toString() },
      create: { key: `CYCLE_STEP_${venue}`, value: step.toString() }
    });
  }

  static async getWorkingCapital(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `WORKING_CAPITAL_${venue}` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async setWorkingCapital(venue: VenueName, amount: number): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `WORKING_CAPITAL_${venue}` },
      update: { value: amount.toString() },
      create: { key: `WORKING_CAPITAL_${venue}`, value: amount.toString() }
    });
  }

  static async getCurrentTarget(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `CURRENT_TARGET_${venue}` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async setCurrentTarget(venue: VenueName, amount: number): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `CURRENT_TARGET_${venue}` },
      update: { value: amount.toString() },
      create: { key: `CURRENT_TARGET_${venue}`, value: amount.toString() }
    });
  }

  static async getActiveChallenge(venue: VenueName) {
    const activeTier = await this.getActiveTier(venue);
    const target = await this.getCurrentTarget(venue);
    const step = await this.getCycleStep(venue);
    const currentPercentage = this.TIER_PERCENTAGES[step % this.TIER_PERCENTAGES.length];
    return {
      tier: activeTier,
      title: `Nivel ${activeTier} (Meta: ${(currentPercentage * 100).toFixed(0)}%)`,
      description: `Generar un sueldo de $${this.SALARY_RESERVE} USD y un ${(currentPercentage * 100).toFixed(0)}% de crecimiento neto.`,
      targetMetric: target,
      currentPercentage: currentPercentage
    };
  }

  static async getScrappyPnL(): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `SCRAPPY_SESSION_PNL` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async addScrappyPnL(amount: number): Promise<number> {
    const current = await this.getScrappyPnL();
    const next = current + amount;
    await prisma.ceoMemory.upsert({
      where: { key: `SCRAPPY_SESSION_PNL` },
      update: { value: next.toString() },
      create: { key: `SCRAPPY_SESSION_PNL`, value: next.toString() }
    });
    return next;
  }

  static async resetScrappyPnL(): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `SCRAPPY_SESSION_PNL` },
      update: { value: "0" },
      create: { key: `SCRAPPY_SESSION_PNL`, value: "0" }
    });
  }

  static async getScrappyReport(): Promise<string> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `SCRAPPY_LAST_REPORT` } });
    return mem ? mem.value : "Sin reportes recientes. Esperando órdenes.";
  }

  static async setScrappyReport(report: string): Promise<void> {
    await prisma.ceoMemory.upsert({
      where: { key: `SCRAPPY_LAST_REPORT` },
      update: { value: report },
      create: { key: `SCRAPPY_LAST_REPORT`, value: report }
    });
  }

  static async getLifetimeScrappyPnL(): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `LIFETIME_SCRAPPY_PNL` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async addLifetimeScrappyPnL(amount: number): Promise<number> {
    const current = await this.getLifetimeScrappyPnL();
    const next = current + amount;
    await prisma.ceoMemory.upsert({
      where: { key: `LIFETIME_SCRAPPY_PNL` },
      update: { value: next.toString() },
      create: { key: `LIFETIME_SCRAPPY_PNL`, value: next.toString() }
    });
    return next;
  }

  static async getLifetimeCeoPnL(venue: VenueName): Promise<number> {
    const mem = await prisma.ceoMemory.findUnique({ where: { key: `LIFETIME_CEO_PNL_${venue}` } });
    return mem ? parseFloat(mem.value) : 0;
  }

  static async addLifetimeCeoPnL(venue: VenueName, amount: number): Promise<number> {
    const current = await this.getLifetimeCeoPnL(venue);
    const next = current + amount;
    await prisma.ceoMemory.upsert({
      where: { key: `LIFETIME_CEO_PNL_${venue}` },
      update: { value: next.toString() },
      create: { key: `LIFETIME_CEO_PNL_${venue}`, value: next.toString() }
    });
    return next;
  }
}
