import { addDays, addMonths, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { Decimal } from 'decimal.js';
import type { Category, Transaction } from '@prisma/client';
import type { CategoryRepository } from '../../categories/infra/category.repository.js';
import type { TransactionRepository } from '../../transactions/infra/transaction.repository.js';

export interface MonthlySummary {
  monthLabel: string;
  income: Decimal;
  expense: Decimal;
  balance: Decimal;
  start: Date;
  endExclusive: Date;
}

export interface DailySummary {
  dayLabel: string;
  weekdayLabel: string;
  income: Decimal;
  expense: Decimal;
  balance: Decimal;
  start: Date;
  endExclusive: Date;
}

export interface CategoryBreakdownRow {
  categoryId: string | null;
  categoryName: string;
  total: Decimal;
}

export class ReportsService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
  ) {}

  /** monthOffset: 0 = mês do `reference` no fuso do usuário; 1 = mês anterior */
  private zonedMonthRange(
    reference: Date,
    timeZone: string,
    monthOffset: number,
  ): { start: Date; endExclusive: Date; label: string } {
    const zRef = toZonedTime(reference, timeZone);
    const zTarget = subMonths(zRef, monthOffset);
    const startLocal = startOfMonth(zTarget);
    const rangeStart = fromZonedTime(startLocal, timeZone);
    const rangeEndExclusive = fromZonedTime(addMonths(startLocal, 1), timeZone);
    const label = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone,
    }).format(rangeStart);
    return { start: rangeStart, endExclusive: rangeEndExclusive, label };
  }

  private zonedDayRange(
    reference: Date,
    timeZone: string,
  ): { start: Date; endExclusive: Date; dayLabel: string; weekdayLabel: string } {
    const zRef = toZonedTime(reference, timeZone);
    const localStart = startOfDay(zRef);
    const rangeStart = fromZonedTime(localStart, timeZone);
    const rangeEndExclusive = fromZonedTime(addDays(localStart, 1), timeZone);
    const dayLabel = new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone,
    }).format(rangeStart);
    const weekdayLabel = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      timeZone,
    }).format(rangeStart);
    return { start: rangeStart, endExclusive: rangeEndExclusive, dayLabel, weekdayLabel };
  }

  private aggregateIncomeExpense(
    agg: { type: string; _sum: { amount: { toString(): string } | null } }[],
  ): { income: Decimal; expense: Decimal } {
    let income = new Decimal(0);
    let expense = new Decimal(0);
    for (const row of agg) {
      const sum = row._sum.amount ? new Decimal(row._sum.amount.toString()) : new Decimal(0);
      if (row.type === 'INCOME') income = income.plus(sum);
      if (row.type === 'EXPENSE') expense = expense.plus(sum);
    }
    return { income, expense };
  }

  private async mapCategoryExpenseBreakdown(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<CategoryBreakdownRow[]> {
    const rows = await this.transactions.groupByCategoryMonth(userId, start, endExclusive);
    const cats = await this.categories.listForUser(userId);
    const byId = new Map<string, Category>(cats.map((c) => [c.id, c]));
    return rows
      .map((r) => {
        const cat = r.categoryId ? byId.get(r.categoryId) : undefined;
        const total = r._sum.amount ? new Decimal(String(r._sum.amount)) : new Decimal(0);
        return {
          categoryId: r.categoryId,
          categoryName: cat?.name ?? 'Sem categoria',
          total,
        };
      })
      .filter((r) => r.total.gt(0))
      .sort((a, b) => b.total.comparedTo(a.total));
  }

  async monthlySummary(
    userId: string,
    timeZone: string,
    reference = new Date(),
    monthOffset = 0,
  ): Promise<MonthlySummary> {
    const { start, endExclusive, label } = this.zonedMonthRange(reference, timeZone, monthOffset);
    const agg = await this.transactions.aggregateMonth(userId, start, endExclusive);
    const { income, expense } = this.aggregateIncomeExpense(agg);
    const balance = income.minus(expense);
    return {
      monthLabel: label,
      income,
      expense,
      balance,
      start,
      endExclusive,
    };
  }

  async compareToPreviousMonth(
    userId: string,
    timeZone: string,
    reference = new Date(),
  ): Promise<{ current: MonthlySummary; previous: MonthlySummary }> {
    const current = await this.monthlySummary(userId, timeZone, reference, 0);
    const previous = await this.monthlySummary(userId, timeZone, reference, 1);
    return { current, previous };
  }

  async categoryBreakdown(
    userId: string,
    timeZone: string,
    reference = new Date(),
  ): Promise<CategoryBreakdownRow[]> {
    const { start, endExclusive } = this.zonedMonthRange(reference, timeZone, 0);
    return this.mapCategoryExpenseBreakdown(userId, start, endExclusive);
  }

  async dailySummary(
    userId: string,
    timeZone: string,
    reference = new Date(),
  ): Promise<DailySummary> {
    const { start, endExclusive, dayLabel, weekdayLabel } = this.zonedDayRange(reference, timeZone);
    const agg = await this.transactions.aggregateMonth(userId, start, endExclusive);
    const { income, expense } = this.aggregateIncomeExpense(agg);
    const balance = income.minus(expense);
    return {
      dayLabel,
      weekdayLabel,
      income,
      expense,
      balance,
      start,
      endExclusive,
    };
  }

  async categoryBreakdownToday(
    userId: string,
    timeZone: string,
    reference = new Date(),
  ): Promise<CategoryBreakdownRow[]> {
    const { start, endExclusive } = this.zonedDayRange(reference, timeZone);
    return this.mapCategoryExpenseBreakdown(userId, start, endExclusive);
  }

  async topExpensesToday(
    userId: string,
    timeZone: string,
    take: number,
    reference = new Date(),
  ): Promise<Array<Transaction & { category: Category | null }>> {
    const { start, endExclusive } = this.zonedDayRange(reference, timeZone);
    return this.transactions.topExpenses(userId, start, endExclusive, take);
  }

  async topExpenses(
    userId: string,
    timeZone: string,
    take: number,
    reference = new Date(),
  ): Promise<Array<Transaction & { category: Category | null }>> {
    const { start, endExclusive } = this.zonedMonthRange(reference, timeZone, 0);
    return this.transactions.topExpenses(userId, start, endExclusive, take);
  }

  async latestTransactions(userId: string, take: number): Promise<Transaction[]> {
    return this.transactions.listLatest(userId, take);
  }
}
