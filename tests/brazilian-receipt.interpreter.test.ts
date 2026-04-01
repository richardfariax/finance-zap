import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import {
  extractMoneyInLine,
  interpretBrazilianReceipt,
  looksLikeOcrGarbageOrTableName,
  parseReceiptDateToIso,
  resolveReceiptOccurredAtUtc,
} from '../src/modules/receipts/application/brazilian-receipt.interpreter.js';
import { Decimal } from 'decimal.js';

describe('extractMoneyInLine', () => {
  it('lê R$ com milhar brasileiro', () => {
    const v = extractMoneyInLine('VALOR TOTAL R$ 4.012,84');
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.value.equals(new Decimal('4012.84')))).toBe(true);
  });
});

describe('looksLikeOcrGarbageOrTableName', () => {
  it('detecta lixo de OCR / tabela', () => {
    expect(looksLikeOcrGarbageOrTableName('ago EEE fds 4 Wat')).toBe(true);
    expect(looksLikeOcrGarbageOrTableName('3322 S38 | 2,79')).toBe(true);
    expect(looksLikeOcrGarbageOrTableName('DIESEL B S10')).toBe(false);
  });
});

describe('interpretBrazilianReceipt', () => {
  it('interpreta cupom de combustível com total e estabelecimento (sem itens)', () => {
    const text = [
      'POSTO 7 BARAO DE ARARAS',
      'CNPJ 12.345.678/0001-99',
      '27/03/2026',
      'DIESEL B S10     3.864,97',
      'ARLA 32            147,87',
      'VALOR TOTAL R$ 4.012,84',
    ].join('\n');

    const r = interpretBrazilianReceipt(text);
    expect(r.tipo).toBe('combustivel');
    expect(r.valor_total).toBeCloseTo(4012.84, 2);
    expect(r.categoria_sugerida).toBe('Transporte');
    expect(r.data).toContain('2026');
    expect(r.confianca).toMatch(/alta|media/);
    expect(r.itens).toEqual([]);
    expect(r.estabelecimento.toLowerCase()).toContain('posto');
  });

  it('usa maior valor quando não há linha de total', () => {
    const text = ['LOJA XYZ', 'Produto A  89,90', 'Outro 10,00'].join('\n');
    const r = interpretBrazilianReceipt(text);
    expect(r.valor_total).toBeCloseTo(89.9, 2);
  });

  it('prefere nome real do posto após lixo de OCR e usa total da linha de cartão sem extrair itens', () => {
    const text = [
      'ago EEE fds 4 Wat',
      'POSTO 7 BARAO DE ARARAS',
      '27/03/2026',
      'DIESEL B S10     3.864,97',
      'ARLA 32            147,87',
      '3322 S38 | 2,79',
      'Cartao de Credito Visa     4.012,84',
    ].join('\n');
    const r = interpretBrazilianReceipt(text);
    expect(r.estabelecimento.toLowerCase()).toContain('posto');
    expect(r.valor_total).toBeCloseTo(4012.84, 2);
    expect(r.itens).toEqual([]);
  });

  it('parseReceiptDateToIso respeita dd/mm/yyyy', () => {
    const d = parseReceiptDateToIso('15/01/2025', new Date());
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('resolveReceiptOccurredAtUtc usa dia do envio no fuso, não data antiga do cupom', () => {
    const tz = 'America/Sao_Paulo';
    const received = new Date('2026-03-31T22:30:00.000Z');
    const utc = resolveReceiptOccurredAtUtc('27/03/2026', received, tz);
    expect(formatInTimeZone(utc, tz, 'yyyy-MM-dd')).toBe('2026-03-31');
  });
});
