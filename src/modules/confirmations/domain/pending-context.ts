export const PendingContextType = {
  CLARIFY_TRANSACTION_TYPE: 'CLARIFY_TRANSACTION_TYPE',
  CLARIFY_AMOUNT: 'CLARIFY_AMOUNT',
  CLARIFY_CATEGORY: 'CLARIFY_CATEGORY',
  LOW_CONFIDENCE_CREATE: 'LOW_CONFIDENCE_CREATE',
} as const;

export type PendingContextTypeValue = (typeof PendingContextType)[keyof typeof PendingContextType];
