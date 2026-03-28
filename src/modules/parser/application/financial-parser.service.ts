import type { Category, Rule, TransactionType } from '@prisma/client';
import { ConfidenceLevel } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { UserIntent, ParseStatus, type UserIntentType } from '../../../shared/types/intent.js';
import { normalizeDescription, normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import type { ParseResult } from '../domain/parse-result.js';
import { KEYWORD_TO_CATEGORY_NAME } from './category-dictionary.js';

export interface ParserContext {
  text: string;
  now: Date;
  userTimezone: string;
  rules: Rule[];
  categories: Category[];
  sourceConfidence?: ConfidenceLevel;
}

function ruleMatches(rule: Rule, rawText: string, normalized: string): boolean {
  const mv = rule.matchValue;
  switch (rule.matchType) {
    case 'CONTAINS':
      return normalized.includes(normalizeForMatch(mv));
    case 'STARTS_WITH':
      return normalized.startsWith(normalizeForMatch(mv));
    case 'NORMALIZED_EQUALS':
      return normalized === normalizeForMatch(mv);
    case 'REGEX':
      try {
        return new RegExp(mv, 'iu').test(rawText);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function findCategoryByCanonicalName(
  categories: Category[],
  canonicalName: string,
): Category | undefined {
  const n = normalizeForMatch(canonicalName);
  return categories.find((c) => c.normalizedName === n);
}

function extractMoney(text: string): { value: Decimal; raw: string } | null {
  const cleaned = text.replace(/\s+/g, ' ');
  const patterns: RegExp[] = [
    /\bR\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})|[\d]+(?:,\d{2})?)\b/giu,
    /\b(?:r\$)?\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})|[\d]+(?:,\d{2})?)\s*(?:reais?)?\b/giu,
    /\b([\d]{1,3}(?:\.\d{3})*,\d{2})\b/g,
    /\b(\d+(?:[.,]\d{2}))\b/g,
  ];

  let best: { value: Decimal; raw: string; len: number } | null = null;
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const raw = m[1] !== undefined && m[1] !== '' ? m[1] : m[0];
      const normalized = raw.replace(/\./g, '').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;
      const d = new Decimal(normalized);
      if (d.lte(0)) continue;
      const len = raw.length;
      if (!best || len > best.len || (len === best.len && d.gt(best.value))) {
        best = { value: d, raw, len };
      }
    }
  }
  return best ? { value: best.value, raw: best.raw } : null;
}

function parseOccurrenceDate(
  normalized: string,
  now: Date,
  timeZone: string,
): Date | null {
  const zonedNow = toZonedTime(now, timeZone);
  if (/\bhoje\b/.test(normalized)) {
    return fromZonedTime(
      new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate(), 12, 0, 0, 0),
      timeZone,
    );
  }
  if (/\bontem\b/.test(normalized)) {
    const y = addDays(zonedNow, -1);
    return fromZonedTime(
      new Date(y.getFullYear(), y.getMonth(), y.getDate(), 12, 0, 0, 0),
      timeZone,
    );
  }
  if (/\banteontem\b/.test(normalized)) {
    const y = addDays(zonedNow, -2);
    return fromZonedTime(
      new Date(y.getFullYear(), y.getMonth(), y.getDate(), 12, 0, 0, 0),
      timeZone,
    );
  }

  const dmY = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dmY) {
    const d = Number(dmY[1]);
    const mo = Number(dmY[2]) - 1;
    let y = dmY[3] ? Number(dmY[3]) : zonedNow.getFullYear();
    if (dmY[3] && y < 100) y += 2000;
    const candidate = new Date(y, mo, d, 12, 0, 0, 0);
    if (!Number.isNaN(candidate.getTime())) {
      return fromZonedTime(candidate, timeZone);
    }
  }

  return null;
}

function inferTransactionType(normalized: string): TransactionType | null {
  if (
    /\b(gastei|paguei|comprei|despesa|debito|débito|cartao|cartão)\b/.test(normalized)
  ) {
    return 'EXPENSE';
  }
  if (/\b(recebi|ganhei|credito|crédito|entrada|salario|salário)\b/.test(normalized)) {
    return 'INCOME';
  }
  if (/\b(transferi|pix para|ted|doc|enviei para)\b/.test(normalized)) {
    return 'TRANSFER';
  }
  if (/\bpix recebido\b/.test(normalized)) {
    return 'INCOME';
  }
  return null;
}

function detectReportIntent(normalized: string): UserIntentType | null {
  if (/\b(ajuda|help|comandos)\b/.test(normalized)) return UserIntent.HELP;
  if (
    /\b(quanto gastei|total de gastos|gastos do mes|gastos do mês|resumo do mes|resumo do mês|saldo do mes|saldo do mês)\b/.test(
      normalized,
    )
  ) {
    return UserIntent.GET_MONTH_SUMMARY;
  }
  if (/\b(onde (estou |)gastando|gastos por categoria|categorias)\b/.test(normalized)) {
    return UserIntent.GET_CATEGORY_BREAKDOWN;
  }
  if (/\b(maiores gastos|top gastos|maiores despesas)\b/.test(normalized)) {
    return UserIntent.GET_TOP_EXPENSES;
  }
  if (/\b(recorrente|gastos fixos|assinaturas fixas)\b/.test(normalized)) {
    return UserIntent.GET_RECURRING_EXPENSES;
  }
  if (/\b(ultimos lancamentos|últimos lançamentos|extrato recente)\b/.test(normalized)) {
    return UserIntent.GET_LAST_TRANSACTIONS;
  }
  return null;
}

function stripIntentWords(text: string): string {
  return text
    .replace(/\b(gastei|paguei|recebi|ganhei|comprei|pix|transferi)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessCategoryFromText(
  normalized: string,
  categories: Category[],
  transactionType: TransactionType,
): { category?: Category; confidence: ConfidenceLevel } {
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    const canonical = KEYWORD_TO_CATEGORY_NAME[t];
    if (!canonical) continue;
    const cat = findCategoryByCanonicalName(categories, canonical);
    if (!cat) continue;
    if (transactionType === 'INCOME' && cat.kind === 'EXPENSE') continue;
    if (transactionType === 'EXPENSE' && cat.kind === 'INCOME') continue;
    return { category: cat, confidence: ConfidenceLevel.HIGH };
  }
  for (const t of tokens) {
    const canonical = KEYWORD_TO_CATEGORY_NAME[t];
    if (!canonical) continue;
    const cat = findCategoryByCanonicalName(categories, canonical);
    if (cat) return { category: cat, confidence: ConfidenceLevel.MEDIUM };
  }
  const fallback = findCategoryByCanonicalName(categories, 'Outros');
  return { category: fallback, confidence: ConfidenceLevel.LOW };
}

function applyRules(
  rules: Rule[],
  raw: string,
  normalized: string,
  categories: Category[],
): { type?: TransactionType; category?: Category } | null {
  for (const r of rules) {
    if (!ruleMatches(r, raw, normalized)) continue;
    const category = r.categoryId
      ? categories.find((c) => c.id === r.categoryId)
      : undefined;
    return { type: r.transactionType ?? undefined, category };
  }
  return null;
}

function mergeConfidence(
  a: ConfidenceLevel,
  b: ConfidenceLevel,
): ConfidenceLevel {
  const rank: Record<ConfidenceLevel, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
  };
  return rank[a] <= rank[b] ? a : b;
}

export class FinancialParserService {
  parse(ctx: ParserContext): ParseResult {
    const raw = ctx.text.trim();
    const normalized = normalizeForMatch(raw);
    const report = detectReportIntent(normalized);
    if (report) {
      return {
        intent: report,
        status: ParseStatus.OK,
        currency: 'BRL',
        occurredAt: ctx.now,
        description: raw,
        normalizedDescription: normalizeDescription(raw),
        confidence: ConfidenceLevel.HIGH,
        sourceConfidence: ctx.sourceConfidence,
      };
    }

    const money = extractMoney(raw);
    const ruleHit = applyRules(ctx.rules, raw, normalized, ctx.categories);

    let transactionType = ruleHit?.type ?? inferTransactionType(normalized);
    const occurredAt =
      parseOccurrenceDate(normalized, ctx.now, ctx.userTimezone) ??
      fromZonedTime(
        (() => {
          const z = toZonedTime(ctx.now, ctx.userTimezone);
          return new Date(z.getFullYear(), z.getMonth(), z.getDate(), 12, 0, 0, 0);
        })(),
        ctx.userTimezone,
      );

    if (!money) {
      if (/\b(gastei|paguei|recebi)\b/.test(normalized) || transactionType) {
        return {
          intent: UserIntent.UNKNOWN,
          status: ParseStatus.NEEDS_CONFIRMATION,
          currency: 'BRL',
          occurredAt,
          description: raw,
          normalizedDescription: normalizeDescription(raw),
          transactionType: transactionType ?? undefined,
          confidence: ConfidenceLevel.LOW,
          clarification: 'Não consegui identificar o valor. Me informe somente o valor.',
          sourceConfidence: ctx.sourceConfidence,
        };
      }
      return {
        intent: UserIntent.UNKNOWN,
        status: ParseStatus.FAILED,
        currency: 'BRL',
        occurredAt,
        description: raw,
        normalizedDescription: normalizeDescription(raw),
        confidence: ConfidenceLevel.LOW,
        clarification: 'Não entendi. Envie um lançamento (ex: "uber 23,50") ou diga "ajuda".',
        sourceConfidence: ctx.sourceConfidence,
      };
    }

    if (!transactionType) {
      const looksLikePerson = /^[a-záàãâéêíóôõúç]+(\s+[a-záàãâéêíóôõúç]+)*\s+\d/.test(normalized);
      if (looksLikePerson) {
        return {
          intent: UserIntent.UNKNOWN,
          status: ParseStatus.NEEDS_CONFIRMATION,
          amount: money.value,
          currency: 'BRL',
          occurredAt,
          description: stripIntentWords(raw),
          normalizedDescription: normalizeDescription(stripIntentWords(raw)),
          confidence: ConfidenceLevel.MEDIUM,
          clarification:
            'Essa movimentação é uma despesa, receita ou transferência? Responda: despesa, receita ou transferência.',
          sourceConfidence: ctx.sourceConfidence,
        };
      }
      transactionType = 'EXPENSE';
    }

    let confidence: ConfidenceLevel = ConfidenceLevel.HIGH;
    const suggested = ruleHit?.category
      ? { category: ruleHit.category, confidence: ConfidenceLevel.HIGH }
      : guessCategoryFromText(normalized, ctx.categories, transactionType);
    confidence = mergeConfidence(confidence, suggested.confidence);

    if (transactionType === 'TRANSFER') {
      confidence = mergeConfidence(confidence, ConfidenceLevel.MEDIUM);
    }

    if (ctx.sourceConfidence) {
      confidence = mergeConfidence(confidence, ctx.sourceConfidence);
    }

    const intentMap: Record<TransactionType, UserIntentType> = {
      EXPENSE: UserIntent.CREATE_EXPENSE,
      INCOME: UserIntent.CREATE_INCOME,
      TRANSFER: UserIntent.CREATE_TRANSFER,
    };

    const status =
      confidence === ConfidenceLevel.LOW ? ParseStatus.NEEDS_CONFIRMATION : ParseStatus.OK;

    return {
      intent: intentMap[transactionType],
      status,
      transactionType,
      amount: money.value,
      currency: 'BRL',
      occurredAt,
      description: stripIntentWords(raw) || raw,
      normalizedDescription: normalizeDescription(stripIntentWords(raw) || raw),
      suggestedCategoryId: suggested.category?.id ?? null,
      suggestedCategoryName: suggested.category?.name ?? null,
      confidence,
      clarification:
        status === ParseStatus.NEEDS_CONFIRMATION
          ? 'Confirme a categoria ou responda com o nome da categoria desejada.'
          : undefined,
      sourceConfidence: ctx.sourceConfidence,
    };
  }
}
