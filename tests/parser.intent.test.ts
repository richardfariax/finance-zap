import { describe, expect, it } from 'vitest';
import { FinancialParserService } from '../src/modules/parser/application/financial-parser.service.js';
import { UserIntent, ParseStatus } from '../src/shared/types/intent.js';
import type { Category, Rule } from '@prisma/client';
import { CategoryKind } from '@prisma/client';

const baseCategories: Category[] = [
  {
    id: 'c1',
    userId: null,
    name: 'Transporte',
    normalizedName: 'transporte',
    kind: CategoryKind.EXPENSE,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'c2',
    userId: null,
    name: 'Mercado',
    normalizedName: 'mercado',
    kind: CategoryKind.EXPENSE,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'c3',
    userId: null,
    name: 'Salário',
    normalizedName: 'salario',
    kind: CategoryKind.INCOME,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'c4',
    userId: null,
    name: 'Outros',
    normalizedName: 'outros',
    kind: CategoryKind.BOTH,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function parseText(text: string, rules: Rule[] = []) {
  const svc = new FinancialParserService();
  return svc.parse({
    text,
    now: new Date('2025-03-27T15:00:00.000Z'),
    userTimezone: 'America/Sao_Paulo',
    rules,
    categories: baseCategories,
  });
}

describe('FinancialParserService', () => {
  it('detecta despesa uber com valor', () => {
    const r = parseText('uber 23,50');
    expect(r.intent).toBe(UserIntent.CREATE_EXPENSE);
    expect(r.amount?.toString()).toBe('23.5');
    expect(r.suggestedCategoryName).toBe('Transporte');
  });

  it('detecta receita de salário', () => {
    const r = parseText('recebi 2500 de salário');
    expect(r.intent).toBe(UserIntent.CREATE_INCOME);
    expect(r.amount?.toString()).toBe('2500');
  });

  it('pede clarificação para nome + valor ambíguo', () => {
    const r = parseText('joão 50');
    expect(r.status).toBe(ParseStatus.NEEDS_CONFIRMATION);
    expect(r.clarification).toContain('despesa');
  });

  it('reconhece resumo mensal', () => {
    const r = parseText('quanto gastei esse mês?');
    expect(r.intent).toBe(UserIntent.GET_MONTH_SUMMARY);
  });
});
