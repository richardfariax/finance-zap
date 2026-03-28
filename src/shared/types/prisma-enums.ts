/**
 * Enums do Prisma via `$Enums`: tipos + objetos em runtime.
 * Evita TS2305 ao importar `ConfidenceLevel`, `TransactionType` etc. direto de `@prisma/client`.
 */
import { $Enums } from '@prisma/client';

export type ConfidenceLevel = $Enums.ConfidenceLevel;
export const ConfidenceLevel = $Enums.ConfidenceLevel;

export type TransactionType = $Enums.TransactionType;
export const TransactionType = $Enums.TransactionType;

export type MessageType = $Enums.MessageType;
export const MessageType = $Enums.MessageType;

export type MessageProvider = $Enums.MessageProvider;
export const MessageProvider = $Enums.MessageProvider;

export type MessageDirection = $Enums.MessageDirection;
export const MessageDirection = $Enums.MessageDirection;

export type TransactionStatus = $Enums.TransactionStatus;
export const TransactionStatus = $Enums.TransactionStatus;

export type CategoryKind = $Enums.CategoryKind;
export const CategoryKind = $Enums.CategoryKind;

export type RecurringFrequency = $Enums.RecurringFrequency;
export const RecurringFrequency = $Enums.RecurringFrequency;
