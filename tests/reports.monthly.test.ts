import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from '../src/modules/reports/application/reports.service.js';
import { TransactionRepository } from '../src/modules/transactions/infra/transaction.repository.js';
import { CategoryRepository } from '../src/modules/categories/infra/category.repository.js';
import { TransactionType } from '@prisma/client';

describe('ReportsService', () => {
  it('calcula saldo do mês a partir do aggregate', async () => {
    const transactions = {
      aggregateMonth: vi.fn(async () => [
        { type: TransactionType.INCOME, _sum: { amount: { toString: () => '3000' } } },
        { type: TransactionType.EXPENSE, _sum: { amount: { toString: () => '1200' } } },
      ]),
      groupByCategoryMonth: vi.fn(async () => []),
      topExpenses: vi.fn(async () => []),
      listLatest: vi.fn(async () => []),
    } as unknown as TransactionRepository;

    const categories = {
      listForUser: vi.fn(async () => []),
    } as unknown as CategoryRepository;

    const svc = new ReportsService(transactions, categories);
    const summary = await svc.monthlySummary(
      'user-1',
      'America/Sao_Paulo',
      new Date('2025-03-15T12:00:00.000Z'),
      0,
    );
    expect(summary.income.toString()).toBe('3000');
    expect(summary.expense.toString()).toBe('1200');
    expect(summary.balance.toString()).toBe('1800');
  });
});
