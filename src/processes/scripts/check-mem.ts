import { prisma } from '../../shared/lib/prisma';

async function main() {
  const mems = await prisma.ceoMemory.findMany();
  console.log(mems);
}

main().catch(console.error).finally(() => prisma.$disconnect());
