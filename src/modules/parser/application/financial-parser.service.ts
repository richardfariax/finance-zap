import type { Category, Rule } from '@prisma/client';
import { ConfidenceLevel, type TransactionType } from '../../../shared/types/prisma-enums.js';
import { Decimal } from 'decimal.js';
import { addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { UserIntent, ParseStatus, type UserIntentType } from '../../../shared/types/intent.js';
import { normalizeDescription, normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import {
  replyParserAskTransactionKind,
  replyParserCorrectionNotLancamento,
  replyParserNeedValueOnly,
  replyParserSuggestCategoryName,
  replyParserUnknownWithExamples,
} from '../../whatsapp/presentation/bot-replies.js';
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
      const raw: string = m[1] ? m[1] : m[0];
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

function parseOccurrenceDate(normalized: string, now: Date, timeZone: string): Date | null {
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

function looksLikeBareCorrectionLanguage(normalized: string): boolean {
  if (
    /\b(gastei|paguei|recebi|comprei|transferi|anotei|gasto|pix\s+de|pix\s+no)\b/.test(normalized)
  ) {
    return false;
  }
  return /\b(corrige|corrigir|conserta|consertar|mudar|muda|alterar|altera|atualizar|atualiza|lancamento|lançamento|na verdade|desconsidera)\b/.test(
    normalized,
  );
}

function inferTransactionType(normalized: string): TransactionType | null {
  if (/\b(gastei|paguei|comprei|despesa|debito|débito|cartao|cartão)\b/.test(normalized)) {
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
  if (
    /\b(tive\s+(?:um\s+)?gasto|foi\s+(?:um\s+)?gasto|deu\s+(?:um\s+)?gasto|saiu\s+(?:um\s+)?dinheiro)\b/.test(
      normalized,
    )
  ) {
    return 'EXPENSE';
  }
  if (/\b(anotei|anotar|anota\s+a[ií])\b/.test(normalized)) {
    return 'EXPENSE';
  }
  return null;
}

const INLINE_AMOUNT_PATTERN =
  '(?:r\\$\\s*)?(?:[\\d]{1,3}(?:\\.[\\d]{3})*(?:,\\d{2})?|\\d+(?:,\\d{2})?)\\s*(?:reais?|real)?';

function toReadableFragment(s: string): string {
  const words = s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w));
  return words
    .map((w) => {
      if (w.length <= 2) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function sentenceCaseRest(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sliceFromVerb(raw: string, verbs: string[]): string {
  const lower = raw.toLowerCase();
  let best = Infinity;
  for (const v of verbs) {
    const j = lower.indexOf(v);
    if (j >= 0 && j < best) best = j;
  }
  if (best === Infinity) return raw;
  return raw.slice(best).trim();
}

function extractNaturalDescription(raw: string, transactionType: TransactionType): string | null {
  const t = raw.trim();
  const amt = INLINE_AMOUNT_PATTERN;

  if (transactionType === 'INCOME') {
    const personRe = new RegExp(
      `^\\s*(?:recebi|ganhei)\\s+${amt}\\s*(?:da|do)\\s+(.+?)\\s*$`,
      'iu',
    );
    const mp = personRe.exec(t);
    if (mp) {
      return `Recebido de: ${toReadableFragment(mp[1])}`;
    }
    const genRe = new RegExp(`^\\s*(?:recebi|ganhei)\\s+${amt}\\s*de\\s+(.+?)\\s*$`, 'iu');
    const mg = genRe.exec(t);
    if (mg) {
      return `Recebido: ${toReadableFragment(mg[1])}`;
    }
    return null;
  }

  if (transactionType === 'EXPENSE') {
    const comprouRe = new RegExp(
      `^\\s*comprei\\s+(?:uma?\\s+)?(.+?)\\s+de\\s+${amt}\\s*(?:reais?|real)?\\s*$`,
      'iu',
    );
    const mc = comprouRe.exec(t);
    if (mc) {
      return `Compra: ${toReadableFragment(mc[1])}`;
    }
    const comprouSimple = new RegExp(
      `^\\s*comprei\\s+${amt}\\s*(?:reais?|real)?\\s*(?:de|no|na)?\\s*(.+?)\\s*$`,
      'iu',
    );
    const mcs = comprouSimple.exec(t);
    if (mcs) {
      return `Compra: ${toReadableFragment(mcs[1])}`;
    }
    const refRe = new RegExp(
      `^\\s*paguei\\s+${amt}\\s*(?:para|pra|pro)\\s+(?:(?:a|o)\\s+)?(.+?)\\s+referente\\s+(?:a|à)\\s+(.+?)\\s*$`,
      'iu',
    );
    const mr = refRe.exec(t);
    if (mr) {
      return `${toReadableFragment(mr[1])} — ${sentenceCaseRest(mr[2])}`;
    }
    const sobreRe = new RegExp(
      `^\\s*paguei\\s+${amt}\\s*(?:para|pra|pro)\\s+(?:(?:a|o)\\s+)?(.+?)\\s+sobre\\s+(.+?)\\s*$`,
      'iu',
    );
    const ms = sobreRe.exec(t);
    if (ms) {
      return `${toReadableFragment(ms[1])} — ${sentenceCaseRest(ms[2])}`;
    }
    const peloRe = new RegExp(
      `^\\s*paguei\\s+${amt}\\s*(?:para|pra|pro)\\s+(?:(?:a|o)\\s+)?(.+?)\\s+(?:pelo|pela)\\s+(.+?)\\s*$`,
      'iu',
    );
    const mpl = peloRe.exec(t);
    if (mpl) {
      return `${toReadableFragment(mpl[1])} — ${sentenceCaseRest(mpl[2])}`;
    }
    const simpleRe = new RegExp(
      `^\\s*paguei\\s+${amt}\\s*(?:para|pra|pro)\\s+(?:(?:a|o)\\s+)?(.+?)\\s*$`,
      'iu',
    );
    const msim = simpleRe.exec(t);
    if (msim) {
      return `Pago a ${toReadableFragment(msim[1])}`;
    }
    return null;
  }

  return null;
}

function isGreetingOnly(normalized: string): boolean {
  const t = normalized.replace(/\s+/g, ' ').trim();
  if (t.length > 64) return false;
  if (/\d/.test(t)) return false;
  return (
    /^(oi+|ola|opa|eae|e ae|salve|hey|hello|hi|beleza|bom dia|boa tarde|boa noite|tudo bem|td bem|como vai|coisa boa|e ai|e a[ií])(\s*[,.!?♥❤])*$/.test(
      t,
    ) || /^(oi|ola)\s+(tudo|td)(\s+bem)?(\s*[,.!?])?$/.test(t)
  );
}

function detectReportIntent(normalized: string): UserIntentType | null {
  if (/\b(ajuda|help|comandos|instrucoes|instruções|menu)\b/.test(normalized)) {
    return UserIntent.HELP;
  }

  const scopeBase =
    /\b(quanto gast(ei)?|total de gastos|gastos|resumo|balanco|balanço|levantamento|extrato)\b/.test(
      normalized,
    );

  const wantsToday =
    scopeBase && /\b(hoje|neste dia|nesse dia|no dia|durante o dia)\b/.test(normalized);

  const wantsMonth =
    /\b(quanto gastei|total de gastos|gastos do mes|gastos do mês|resumo do mes|resumo do mês|saldo do mes|saldo do mês|gastos no mes|gastos no mês|gastos deste mes|gastos deste mês|gastos esse mes|gastos esse mês|quanto gastei no mes|quanto gastei no mês|quanto gastei esse mes|quanto gastei esse mês|balanco do mes|balanço do mês|balanco do mês)\b/.test(
      normalized,
    ) ||
    (scopeBase &&
      /\b(neste mes|neste mês|esse mes|esse mês|este mes|este mês|do mes|do mês|mes atual|mês atual)\b/.test(
        normalized,
      ));

  if (/\bresumo\b/.test(normalized) && !wantsToday && !wantsMonth) {
    return UserIntent.CLARIFY_REPORT_PERIOD;
  }

  if (wantsToday) {
    return UserIntent.GET_TODAY_SUMMARY;
  }
  if (wantsMonth) {
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
    .replace(/\b(gastei|paguei|recebi|ganhei|comprei|pix|transferi|anotei|anotar|anota)\b/giu, ' ')
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

function isTwoElementTuple(a: string[]): a is [string, string] {
  return a.length === 2;
}

function applyRules(
  rules: Rule[],
  raw: string,
  normalized: string,
  categories: Category[],
): { type?: TransactionType; category?: Category } | null {
  for (const r of rules) {
    if (!ruleMatches(r, raw, normalized)) continue;
    const category = r.categoryId ? categories.find((c) => c.id === r.categoryId) : undefined;
    return { type: r.transactionType ?? undefined, category };
  }
  return null;
}

function mergeConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
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
    if (isGreetingOnly(normalized)) {
      return {
        intent: UserIntent.GREETING,
        status: ParseStatus.OK,
        currency: 'BRL',
        occurredAt: ctx.now,
        description: raw,
        normalizedDescription: normalizeDescription(raw),
        confidence: ConfidenceLevel.HIGH,
        sourceConfidence: ctx.sourceConfidence,
      };
    }
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
          clarification: replyParserNeedValueOnly(),
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
        clarification: replyParserUnknownWithExamples(),
        sourceConfidence: ctx.sourceConfidence,
      };
    }

    if (!transactionType) {
      const tokens = normalized.split(/\s+/).filter(Boolean);
      let looksLikePerson = false;
      if (isTwoElementTuple(tokens)) {
        const [first, second] = tokens;
        const knownMerchantOrCategory = Object.hasOwn(KEYWORD_TO_CATEGORY_NAME, first);
        looksLikePerson = !knownMerchantOrCategory && /^[a-z]+$/u.test(first) && /^\d/.test(second);
      }
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
          clarification: replyParserAskTransactionKind(),
          sourceConfidence: ctx.sourceConfidence,
        };
      }
      if (looksLikeBareCorrectionLanguage(normalized)) {
        return {
          intent: UserIntent.UNKNOWN,
          status: ParseStatus.FAILED,
          currency: 'BRL',
          occurredAt,
          description: raw,
          normalizedDescription: normalizeDescription(raw),
          confidence: ConfidenceLevel.LOW,
          clarification: replyParserCorrectionNotLancamento(),
          sourceConfidence: ctx.sourceConfidence,
        };
      }
      transactionType = 'EXPENSE';
    }

    const rawForNatural =
      transactionType === 'INCOME'
        ? sliceFromVerb(raw, ['recebi', 'ganhei'])
        : transactionType === 'EXPENSE'
          ? sliceFromVerb(raw, ['paguei', 'comprei', 'gastei'])
          : raw;
    const naturalDesc =
      transactionType === 'INCOME' || transactionType === 'EXPENSE'
        ? extractNaturalDescription(rawForNatural, transactionType)
        : null;

    let suggested = ruleHit?.category
      ? { category: ruleHit.category, confidence: ConfidenceLevel.HIGH }
      : guessCategoryFromText(normalized, ctx.categories, transactionType);

    const outros = findCategoryByCanonicalName(ctx.categories, 'Outros');
    if (transactionType === 'INCOME' && naturalDesc) {
      if (/^recebido de\b/i.test(naturalDesc)) {
        suggested = { category: outros, confidence: ConfidenceLevel.HIGH };
      } else if (/^recebido:/i.test(naturalDesc)) {
        const frag = naturalDesc.replace(/^recebido:\s*/i, '').trim();
        const g = guessCategoryFromText(normalizeForMatch(frag), ctx.categories, transactionType);
        suggested =
          g.confidence === ConfidenceLevel.LOW
            ? { category: outros, confidence: ConfidenceLevel.HIGH }
            : g;
      }
    }
    if (
      transactionType === 'EXPENSE' &&
      naturalDesc &&
      !ruleHit?.category &&
      !/^compra:/iu.test(naturalDesc.trim())
    ) {
      suggested = { category: outros, confidence: ConfidenceLevel.HIGH };
    }

    let confidence: ConfidenceLevel = ConfidenceLevel.HIGH;
    confidence = mergeConfidence(confidence, suggested.confidence);

    if (transactionType === 'TRANSFER') {
      confidence = mergeConfidence(confidence, ConfidenceLevel.MEDIUM);
    }

    const trustNaturalStructure = naturalDesc !== null;
    if (
      ctx.sourceConfidence &&
      !trustNaturalStructure &&
      suggested.confidence !== ConfidenceLevel.HIGH
    ) {
      confidence = mergeConfidence(confidence, ctx.sourceConfidence);
    }

    const description = naturalDesc ?? (stripIntentWords(raw) || raw);

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
      description,
      normalizedDescription: normalizeDescription(description),
      suggestedCategoryId: suggested.category?.id ?? null,
      suggestedCategoryName: suggested.category?.name ?? null,
      confidence,
      clarification:
        status === ParseStatus.NEEDS_CONFIRMATION
          ? replyParserSuggestCategoryName(suggested.category?.name ?? null)
          : undefined,
      sourceConfidence: ctx.sourceConfidence,
    };
  }
}
