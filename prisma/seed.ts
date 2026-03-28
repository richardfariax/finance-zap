import { PrismaClient, CategoryKind } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { normalizeForMatch } from '../src/shared/utils/normalize-text.js';

const prisma = new PrismaClient();

const SYSTEM_CATEGORIES: { name: string; kind: CategoryKind }[] = [
  { name: 'Alimentação', kind: CategoryKind.EXPENSE },
  { name: 'Mercado', kind: CategoryKind.EXPENSE },
  { name: 'Transporte', kind: CategoryKind.EXPENSE },
  { name: 'Moradia', kind: CategoryKind.EXPENSE },
  { name: 'Saúde', kind: CategoryKind.EXPENSE },
  { name: 'Lazer', kind: CategoryKind.EXPENSE },
  { name: 'Educação', kind: CategoryKind.EXPENSE },
  { name: 'Salário', kind: CategoryKind.INCOME },
  { name: 'Vendas', kind: CategoryKind.INCOME },
  { name: 'Assinaturas', kind: CategoryKind.EXPENSE },
  { name: 'Transferências', kind: CategoryKind.BOTH },
  { name: 'Outros', kind: CategoryKind.BOTH },
];

async function main(): Promise<void> {
  for (const c of SYSTEM_CATEGORIES) {
    const normalizedName = normalizeForMatch(c.name);
    const existing = await prisma.category.findFirst({
      where: { userId: null, normalizedName, isSystem: true },
    });
    if (existing) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { name: c.name, kind: c.kind },
      });
    } else {
      await prisma.category.create({
        data: {
          id: uuidv4(),
          name: c.name,
          normalizedName,
          kind: c.kind,
          isSystem: true,
          userId: null,
        },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
