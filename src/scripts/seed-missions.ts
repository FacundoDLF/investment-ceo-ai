import { prisma } from '../shared/lib/prisma';

async function main() {
  console.log("Seeding challenges...");

  const challenges = [
    {
      id: "challenge_tier_1",
      tier: 1,
      title: "Misión: Cimiento (Supervivencia y Reserva Base)",
      description: "Acumular los primeros dólares para generar una reserva intocable. Operar con bajo riesgo, buscando acumulación constante.",
      targetMetric: 2000,
      status: "ACTIVE"
    },
    {
      id: "challenge_tier_2",
      tier: 2,
      title: "Misión: Expansión (Riesgo Asimétrico)",
      description: "Usar el capital excedente a la reserva para hacer crecer el portafolio de manera más agresiva.",
      targetMetric: 5000,
      status: "LOCKED"
    },
    {
      id: "challenge_tier_3",
      tier: 3,
      title: "Misión: Imperio (Diversificación Pasiva)",
      description: "Mantener crecimiento agresivo mientras se construye una cartera de dividendos a largo plazo.",
      targetMetric: 10000,
      status: "LOCKED"
    }
  ];

  for (const c of challenges) {
    await prisma.challenge.upsert({
      where: { id: c.id },
      update: {
        title: c.title,
        description: c.description,
        targetMetric: c.targetMetric,
        tier: c.tier
      },
      create: {
        id: c.id,
        tier: c.tier,
        title: c.title,
        description: c.description,
        targetMetric: c.targetMetric,
        status: c.status
      }
    });
    console.log(`Upserted challenge Tier ${c.tier}`);
  }

  console.log("Done.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
