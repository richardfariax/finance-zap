import { addDays, differenceInCalendarDays } from 'date-fns';
import { Decimal } from 'decimal.js';
import type { Prisma } from '@prisma/client';
import { RecurringFrequency } from '../../../shared/types/prisma-enums.js';
import { prisma } from '../../../shared/infra/prisma.js';
import { createHash } from 'node:crypto';

interface Tx {
  id: string;
  normalizedDescription: string;
  amount: Prisma.Decimal;
  occurredAt: Date;
  categoryId: string | null;
}

function fingerprint(description: string, amount: Decimal): string {
  const base = `${description}|${amount.toFixed(2)}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}

function amountsSimilar(a: Decimal, b: Decimal, pct = 0.15): boolean {
  const max = Decimal.max(a.abs(), b.abs());
  if (max.isZero()) return true;
  return a.minus(b).abs().div(max).lte(pct);
}

function detectFrequency(dates: Date[]): RecurringFrequency {
  if (dates.length < 2) return RecurringFrequency.UNKNOWN;
  const sorted = [...dates].sort((x, y) => x.getTime() - y.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(differenceInCalendarDays(sorted[i], sorted[i - 1]));
  }
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (avg >= 5 && avg <= 10) return RecurringFrequency.WEEKLY;
  if (avg >= 25 && avg <= 35) return RecurringFrequency.MONTHLY;
  return RecurringFrequency.UNKNOWN;
}

export class RecurrenceDetectorService {
  async refreshForUser(userId: string, lookbackDays = 120): Promise<void> {
    const since = addDays(new Date(), -lookbackDays);
    const txs = (await prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: 'EXPENSE',
        occurredAt: { gte: since },
      },
      select: {
        id: true,
        normalizedDescription: true,
        amount: true,
        occurredAt: true,
        categoryId: true,
      },
      orderBy: { occurredAt: 'asc' },
    })) as Tx[];

    const groups = new Map<string, Tx[]>();
    for (const t of txs) {
      const amount = new Decimal(t.amount.toString());
      const fp = fingerprint(t.normalizedDescription, amount);
      const list = groups.get(fp) ?? [];
      list.push(t);
      groups.set(fp, list);
    }

    for (const [fp, list] of groups) {
      if (list.length < 2) continue;
      const ref = list.at(-1);
      if (ref === undefined) continue;
      const amounts = list.map((x) => new Decimal(x.amount.toString()));
      const allSimilar = amounts.every((a) => amountsSimilar(a, amounts[0] ?? a));
      if (!allSimilar) continue;
      const freq = detectFrequency(list.map((l) => l.occurredAt));
      const estimated = amounts.reduce((s, a) => s.plus(a), new Decimal(0)).div(amounts.length);

      await prisma.recurringPattern.upsert({
        where: { userId_fingerprint: { userId, fingerprint: fp } },
        create: {
          userId,
          fingerprint: fp,
          description: ref.normalizedDescription,
          categoryId: ref.categoryId,
          estimatedAmount: estimated,
          frequency: freq,
          lastDetectedAt: new Date(),
        },
        update: {
          description: ref.normalizedDescription,
          categoryId: ref.categoryId,
          estimatedAmount: estimated,
          frequency: freq,
          lastDetectedAt: new Date(),
        },
      });
    }
  }

  async listForUser(userId: string) {
    return prisma.recurringPattern.findMany({
      where: { userId },
      orderBy: { lastDetectedAt: 'desc' },
      include: { category: true },
    });
  }
}
