import { describe, expect, it } from 'vitest';
import { FinancialParserService } from '../src/modules/parser/application/financial-parser.service.js';
import { UserIntent, ParseStatus } from '../src/shared/types/intent.js';
import type { Category, Rule } from '@prisma/client';
import { CategoryKind, ConfidenceLevel } from '@prisma/client';

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
  {
    id: 'c5',
    userId: null,
    name: 'Alimentação',
    normalizedName: 'alimentacao',
    kind: CategoryKind.EXPENSE,
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

  it('comprei pizza: categoria Alimentação e registro direto', () => {
    const r = parseText('Comprei uma pizza de 50 reais');
    expect(r.intent).toBe(UserIntent.CREATE_EXPENSE);
    expect(r.amount?.toString()).toBe('50');
    expect(r.status).toBe(ParseStatus.OK);
    expect(r.suggestedCategoryName).toBe('Alimentação');
    expect(r.description.toLowerCase()).toContain('pizza');
  });

  it('detecta receita de salário', () => {
    const r = parseText('recebi 2500 de salário');
    expect(r.intent).toBe(UserIntent.CREATE_INCOME);
    expect(r.amount?.toString()).toBe('2500');
  });

  it('pede clarificação para nome + valor ambíguo', () => {
    const r = parseText('fulano 50');
    expect(r.status).toBe(ParseStatus.NEEDS_CONFIRMATION);
    expect(r.clarification).toContain('despesa');
  });

  it('reconhece resumo mensal', () => {
    const r = parseText('quanto gastei esse mês?');
    expect(r.intent).toBe(UserIntent.GET_MONTH_SUMMARY);
  });

  it('reconhece levantamento do dia (hoje)', () => {
    const r = parseText('quanto gastei hoje?');
    expect(r.intent).toBe(UserIntent.GET_TODAY_SUMMARY);
  });

  it('reconhece ajuda formal', () => {
    const r = parseText('preciso de ajuda');
    expect(r.intent).toBe(UserIntent.HELP);
  });

  it('frase natural: receita de pessoa (recebi … da …)', () => {
    const r = parseText('recebi 50 reais de fulano');
    expect(r.intent).toBe(UserIntent.CREATE_INCOME);
    expect(r.amount?.toString()).toBe('50');
    expect(r.description).toContain('Luana');
    expect(r.description.toLowerCase()).toContain('recebido');
  });

  it('frase natural: despesa para pessoa com referência', () => {
    const r = parseText('paguei 150 para a maiara referente a pagamento tal');
    expect(r.intent).toBe(UserIntent.CREATE_EXPENSE);
    expect(r.amount?.toString()).toBe('150');
    expect(r.description).toMatch(/Maiara/i);
    expect(r.description.toLowerCase()).toContain('pagamento tal');
  });

  it('frase natural: pago a alguém sem observação extra', () => {
    const r = parseText('paguei 80 pra fulano');
    expect(r.intent).toBe(UserIntent.CREATE_EXPENSE);
    expect(r.amount?.toString()).toBe('80');
    expect(r.description).toMatch(/Fulano/i);
    expect(r.description.toLowerCase()).toContain('pago');
  });

  it('detecta saudação curta', () => {
    const r = parseText('Oi');
    expect(r.intent).toBe(UserIntent.GREETING);
    expect(r.status).toBe(ParseStatus.OK);
  });

  it('áudio: despesa com palavra-chave forte não fica presa em confirmação (source LOW)', () => {
    const svc = new FinancialParserService();
    const r = svc.parse({
      text: 'gastei 23,50 no uber',
      now: new Date('2025-03-27T15:00:00.000Z'),
      userTimezone: 'America/Sao_Paulo',
      rules: [],
      categories: baseCategories,
      sourceConfidence: ConfidenceLevel.LOW,
    });
    expect(r.intent).toBe(UserIntent.CREATE_EXPENSE);
    expect(r.status).toBe(ParseStatus.OK);
    expect(r.suggestedCategoryName).toBe('Transporte');
  });

  it('áudio simulado: receita da pessoa sem pedir confirmação (ignora sourceConfidence baixa)', () => {
    const svc = new FinancialParserService();
    const r = svc.parse({
      text: 'recebi 50 reais de fulano',
      now: new Date('2025-03-27T15:00:00.000Z'),
      userTimezone: 'America/Sao_Paulo',
      rules: [],
      categories: baseCategories,
      sourceConfidence: ConfidenceLevel.LOW,
    });
    expect(r.intent).toBe(UserIntent.CREATE_INCOME);
    expect(r.status).toBe(ParseStatus.OK);
    expect(r.suggestedCategoryName).toBe('Outros');
  });

  it('ignora "oi" no começo do áudio e entende recebi…da…', () => {
    const svc = new FinancialParserService();
    const r = svc.parse({
      text: 'Oi, recebi 50 reais de fulano',
      now: new Date('2025-03-27T15:00:00.000Z'),
      userTimezone: 'America/Sao_Paulo',
      rules: [],
      categories: baseCategories,
      sourceConfidence: ConfidenceLevel.LOW,
    });
    expect(r.intent).toBe(UserIntent.CREATE_INCOME);
    expect(r.status).toBe(ParseStatus.OK);
  });
});
