import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  TRANSACTION_TYPE_CHOICE_PHRASE,
  formatMoney,
  occurrenceLabelForReply,
  replyParserAskTransactionKind,
  replyParserSuggestCategoryName,
  replyExpenseRegistered,
} from '../src/modules/whatsapp/presentation/bot-replies.js';
import { TransactionType } from '../src/shared/types/prisma-enums.js';

describe('bot-replies', () => {
  it('formatMoney usa BRL pt-BR', () => {
    expect(formatMoney(new Decimal('23.5'))).toMatch(/23/);
    expect(formatMoney(new Decimal('23.5'))).toContain('R');
  });

  it('clarificação de tipo inclui frase estável para o ingest', () => {
    const msg = replyParserAskTransactionKind();
    expect(msg).toContain(TRANSACTION_TYPE_CHOICE_PHRASE);
  });

  it('confirmação de gasto inclui seções esperadas', () => {
    const msg = replyExpenseRegistered(
      new Decimal('50'),
      'Mercado',
      'Alimentação',
      'Hoje',
      new Decimal('1200'),
    );
    expect(msg).toContain('Gasto registrado');
    expect(msg).toContain('Mercado');
    expect(msg).toContain('Alimentação');
    expect(msg).toContain('Saldo:');
    expect(msg).toMatch(/1\.200/);
  });

  it('confirmação de categoria inclui valor, categoria e opções de resposta', () => {
    const msg = replyParserSuggestCategoryName(
      'Mercado',
      new Decimal('50'),
      TransactionType.EXPENSE,
    );
    expect(msg).toContain('Mercado');
    expect(msg).toContain('*sim*');
    expect(msg).toContain('Como responder:');
    expect(msg).toContain('*quais categorias*');
    expect(msg).toContain('*cancelar*');
  });

  it('occurrenceLabelForReply delega ao util de data', () => {
    const tz = 'America/Sao_Paulo';
    const now = new Date('2025-03-15T15:00:00.000Z');
    const d = new Date('2025-03-15T08:00:00.000Z');
    expect(occurrenceLabelForReply(d, now, tz)).toBe('Hoje');
  });
});
