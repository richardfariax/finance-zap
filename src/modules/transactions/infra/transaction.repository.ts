import type {
  Category,
  ConfidenceLevel,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';
import type { Decimal } from 'decimal.js';

export class TransactionRepository {
  async create(data: Prisma.TransactionCreateInput): Promise<Transaction> {
    return prisma.transaction.create({ data });
  }

  async findLastForUser(userId: string): Promise<(Transaction & { category: Category | null }) | null> {
    return prisma.transaction.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { category: true },
    });
  }

  async findActiveById(id: string, userId: string): Promise<Transaction | null> {
    return prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      include: { category: true },
    });
  }

  async softDelete(id: string, userId: string): Promise<Transaction | null> {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) return null;
    return prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
  }

  async updateAmount(id: string, userId: string, amount: Decimal): Promise<Transaction | null> {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) return null;
    return prisma.transaction.update({
      where: { id },
      data: { amount: amount.toString() },
    });
  }

  async updateCategory(
    id: string,
    userId: string,
    categoryId: string | null,
  ): Promise<Transaction | null> {
    const existing = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) return null;
    return prisma.transaction.update({
      where: { id },
      data: { categoryId },
    });
  }

  async listLatest(
    userId: string,
    take: number,
  ): Promise<Array<Transaction & { category: Category | null }>> {
    return prisma.transaction.findMany({
      where: { userId, deletedAt: null },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { category: true },
    });
  }

  async aggregateMonth(userId: string, start: Date, end: Date) {
    return prisma.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        deletedAt: null,
        occurredAt: { gte: start, lt: end },
        NOT: { status: 'CANCELLED' },
      },
      _sum: { amount: true },
    });
  }

  async groupByCategoryMonth(userId: string, start: Date, end: Date) {
    return prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        deletedAt: null,
        type: 'EXPENSE',
        occurredAt: { gte: start, lt: end },
        NOT: { status: 'CANCELLED' },
      },
      _sum: { amount: true },
    });
  }

  async topExpenses(
    userId: string,
    start: Date,
    end: Date,
    take: number,
  ): Promise<Array<Transaction & { category: Category | null }>> {
    return prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: 'EXPENSE',
        occurredAt: { gte: start, lt: end },
        NOT: { status: 'CANCELLED' },
      },
      orderBy: { amount: 'desc' },
      take,
      include: { category: true },
    });
  }

  async listForFingerprinting(
    userId: string,
    since: Date,
  ): Promise<
    {
      id: string;
      normalizedDescription: string;
      amount: Prisma.Decimal;
      occurredAt: Date;
      categoryId: string | null;
    }[]
  > {
    return prisma.transaction.findMany({
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
    });
  }

  async countForUser(userId: string): Promise<number> {
    return prisma.transaction.count({ where: { userId, deletedAt: null } });
  }
}

export type { TransactionType, TransactionStatus, ConfidenceLevel };
