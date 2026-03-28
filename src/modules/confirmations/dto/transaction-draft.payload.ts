import { TransactionType } from '@prisma/client';
import { z } from 'zod';

export const TransactionDraftPayloadSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  occurredAt: z.string(),
  description: z.string(),
  normalizedDescription: z.string(),
  suggestedCategoryId: z.string().uuid().nullable(),
  merchant: z.string().optional(),
  transactionType: z.nativeEnum(TransactionType).optional(),
  /** Texto bruto que abriu a pendência (para detectar repetição sem cancelar). */
  originalUserText: z.string().max(4000).optional(),
});

export type TransactionDraftPayload = z.infer<typeof TransactionDraftPayloadSchema>;
