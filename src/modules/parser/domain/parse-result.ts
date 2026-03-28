import type { ConfidenceLevel, TransactionType } from '@prisma/client';
import type { Decimal } from 'decimal.js';
import type { ParseStatusType, UserIntentType } from '../../../shared/types/intent.js';

export interface ParseResult {
  intent: UserIntentType;
  status: ParseStatusType;
  transactionType?: TransactionType;
  amount?: Decimal;
  currency: string;
  occurredAt: Date;
  description: string;
  normalizedDescription: string;
  merchant?: string;
  suggestedCategoryId?: string | null;
  suggestedCategoryName?: string | null;
  confidence: ConfidenceLevel;
  clarification?: string;
  sourceConfidence?: ConfidenceLevel;
}
