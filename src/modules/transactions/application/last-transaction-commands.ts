import { Decimal } from 'decimal.js';
import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import {
  isMoneyOnlySegment,
  splitFinancialSegments,
} from '../../../shared/utils/split-financial-segments.js';

export type LastTxCommand =
  | { kind: 'DELETE_LAST' }
  | { kind: 'UPDATE_LAST_AMOUNT'; amount: Decimal }
  | { kind: 'UPDATE_LAST_AMOUNT_NEEDS_VALUE' }
  | { kind: 'UPDATE_LAST_CATEGORY'; categoryHint: string }
  | { kind: 'NONE' };

function extractMoneyToken(text: string): Decimal | null {
  const re = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)/;
  const m = text.match(re);
  if (!m) return null;
  const n = m[1].replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  return new Decimal(n);
}

/**
 * Valor a usar ao corrigir o último lançamento: prefere o número depois de para/pra/era/foi;
 * senão, o último valor monetário do texto (ex.: "uber 10, corrige último para 59").
 */
export function extractMoneyForLastTxCorrection(raw: string): Decimal | null {
  let lastPara = -1;
  const rePara = /\b(para|pra)\b/giu;
  let m: RegExpExecArray | null;
  while ((m = rePara.exec(raw)) !== null) {
    lastPara = m.index;
  }
  if (lastPara >= 0) {
    const after = raw.slice(lastPara);
    const fromPara = extractMoneyToken(after);
    if (fromPara) return fromPara;
  }

  let lastEra = -1;
  const reEra = /\b(era|foi|deveria ser)\b/giu;
  while ((m = reEra.exec(raw)) !== null) {
    lastEra = m.index;
  }
  if (lastEra >= 0) {
    const after = raw.slice(lastEra);
    const fromEra = extractMoneyToken(after);
    if (fromEra) return fromEra;
  }

  const globalRe = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)/g;
  const found: Decimal[] = [];
  while ((m = globalRe.exec(raw)) !== null) {
    const n = m[1].replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(n)) continue;
    const d = new Decimal(n);
    if (d.gt(0)) found.push(d);
  }
  if (found.length === 0) return null;
  return found[found.length - 1] ?? null;
}

function hasUltimoRef(n: string): boolean {
  return /\b(ultimo|último|ultima|última)\b/.test(n);
}

function hasCorrectionVerb(n: string): boolean {
  return /\b(corrige|corrigir|muda|mudar|altera|alterar|atualiza|atualizar|conserta|consertar)\b/.test(
    n,
  );
}

/** Frase pedindo ajuste de valor do último, mas sem número identificável. */
export function isLastTxAmountCorrectionMissingValue(raw: string): boolean {
  const n = normalizeForMatch(raw);
  if (!hasUltimoRef(n) || !hasCorrectionVerb(n)) return false;
  return extractMoneyForLastTxCorrection(raw) === null;
}

/**
 * Trecho seguinte pode completar "corrige o último" → "corrige o último, 59,90" ou ", era 50".
 */
function isCorrectionValueTailSegment(seg: string): boolean {
  const t = seg.trim();
  if (isMoneyOnlySegment(t)) return true;
  const n = normalizeForMatch(t);
  if (/\b(era|foi|deveria ser)\b/.test(n) && extractMoneyForLastTxCorrection(t) !== null) {
    return true;
  }
  return false;
}

/**
 * Divide por vírgula (preservando decimais PT-BR) e junta de novo pedaços de correção
 * partidos por vírgula coloquial ("corrige o último, era 50").
 */
export function prepareTransactionInboundSegments(text: string): string[] {
  const parts = splitFinancialSegments(text);
  const merged: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const s = parts.at(i);
    const next = parts.at(i + 1);
    if (s === undefined) break;
    if (
      next !== undefined &&
      isLastTxAmountCorrectionMissingValue(s) &&
      isCorrectionValueTailSegment(next)
    ) {
      merged.push(`${s}, ${next}`);
      i += 2;
      continue;
    }
    merged.push(s);
    i += 1;
  }
  return merged;
}

function tryImplicitLastAmountCorrection(raw: string, n: string): LastTxCommand {
  const trimmed = raw.trim();
  if (trimmed.length > 96) return { kind: 'NONE' };
  if (hasUltimoRef(n)) return { kind: 'NONE' };
  if (/\b(gastei|paguei|recebi|comprei|transferi|anotei|gasto|pix)\b/.test(n)) {
    return { kind: 'NONE' };
  }
  const implicit =
    /^\s*(corrige|corrigir|muda|mudar|altera|alterar|atualiza|atualizar)\s+(?:o\s+)?(?:valor\s+)?(?:para|pra)\s+/iu.test(
      trimmed,
    );
  if (!implicit) return { kind: 'NONE' };
  const amount = extractMoneyForLastTxCorrection(raw);
  if (!amount) return { kind: 'UPDATE_LAST_AMOUNT_NEEDS_VALUE' };
  return { kind: 'UPDATE_LAST_AMOUNT', amount };
}

export function parseLastTransactionCommand(raw: string): LastTxCommand {
  const n = normalizeForMatch(raw);

  if (
    /\b(apaga|apagar|deleta|deletar|remove|remover|exclui|excluir)\b/.test(n) &&
    hasUltimoRef(n) &&
    /\b(lancamento|lançamento|gasto|registro)\b/.test(n)
  ) {
    return { kind: 'DELETE_LAST' };
  }

  if (/\b(apaga|apagar|deleta|deletar)\b/.test(n) && hasUltimoRef(n)) {
    return { kind: 'DELETE_LAST' };
  }

  if (
    /\b(corrige|corrigir|muda|mudar|altera|alterar)\b/.test(n) &&
    hasUltimoRef(n) &&
    /\b(categoria)\b/.test(n)
  ) {
    const cleaned = raw.replace(
      /\b(corrige|corrigir|muda|mudar|altera|alterar|ultimo|último|ultima|última|categoria|para|pra)\b/giu,
      ' ',
    );
    const hint = cleaned.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    if (hint.length >= 2) return { kind: 'UPDATE_LAST_CATEGORY', categoryHint: hint };
  }

  if (hasCorrectionVerb(n) && hasUltimoRef(n)) {
    const amount = extractMoneyForLastTxCorrection(raw);
    if (amount) return { kind: 'UPDATE_LAST_AMOUNT', amount };
    return { kind: 'UPDATE_LAST_AMOUNT_NEEDS_VALUE' };
  }

  const implicit = tryImplicitLastAmountCorrection(raw, n);
  if (implicit.kind !== 'NONE') return implicit;

  if (/\b(muda|mudar)\b/.test(n) && /\b(categoria)\b/.test(n) && /\b(para|pra)\b/.test(n)) {
    const parts = raw.split(/\b(para|pra)\b/i);
    const hint = (parts[1] ?? '').trim();
    if (hint.length >= 2) return { kind: 'UPDATE_LAST_CATEGORY', categoryHint: hint };
  }

  return { kind: 'NONE' };
}
