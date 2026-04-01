import { z } from 'zod';

export const ReceiptOcrConfirmPayloadSchema = z.object({
  amount: z.string().min(1),
  currency: z.string().default('BRL'),
  description: z.string().min(1),
  normalizedDescription: z.string().min(1),
  categoryId: z.string().uuid().nullable(),
  occurredAt: z.string().min(1),
  userTimezone: z.string().min(1),
  imageMessageId: z.string().uuid(),
});

export type ReceiptOcrConfirmPayload = z.infer<typeof ReceiptOcrConfirmPayloadSchema>;
