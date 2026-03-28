import type { ConfidenceLevel, TransactionType } from '@prisma/client';
import { TransactionStatus } from '@prisma/client';
import type { Decimal } from 'decimal.js';
import type { AuditService } from '../../audit/application/audit.service.js';
import type { RecurrenceDetectorService } from '../../recurrence/application/recurrence-detector.service.js';
import type { TransactionRepository } from '../infra/transaction.repository.js';

export class CreateTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly recurrence: RecurrenceDetectorService,
  ) {}

  async execute(input: {
    userId: string;
    sourceMessageId?: string | null;
    type: TransactionType;
    amount: Decimal;
    currency: string;
    description: string;
    normalizedDescription: string;
    categoryId?: string | null;
    subcategory?: string | null;
    occurredAt: Date;
    confidence: ConfidenceLevel;
    status?: TransactionStatus;
  }) {
    const tx = await this.transactions.create({
      user: { connect: { id: input.userId } },
      ...(input.sourceMessageId ? { message: { connect: { id: input.sourceMessageId } } } : {}),
      type: input.type,
      amount: input.amount.toString(),
      currency: input.currency,
      description: input.description,
      normalizedDescription: input.normalizedDescription,
      category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
      subcategory: input.subcategory ?? undefined,
      occurredAt: input.occurredAt,
      status: input.status ?? TransactionStatus.CONFIRMED,
      confidence: input.confidence,
    });

    await this.audit.log({
      userId: input.userId,
      action: 'TRANSACTION_CREATED',
      entityType: 'Transaction',
      entityId: tx.id,
      after: {
        type: tx.type,
        amount: tx.amount.toString(),
        description: tx.description,
        categoryId: tx.categoryId,
      },
    });

    void this.recurrence.refreshForUser(input.userId).catch(() => undefined);

    return tx;
  }
}
