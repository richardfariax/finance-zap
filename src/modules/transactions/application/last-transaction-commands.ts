import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import { Decimal } from 'decimal.js';

export type LastTxCommand =
  | { kind: 'DELETE_LAST' }
  | { kind: 'UPDATE_LAST_AMOUNT'; amount: Decimal }
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

export function parseLastTransactionCommand(raw: string): LastTxCommand {
  const n = normalizeForMatch(raw);

  if (
    /\b(apaga|apagar|deleta|deletar|remove|remover|exclui|excluir)\b/.test(n) &&
    /\b(ultimo|último|ultima|última)\b/.test(n) &&
    /\b(lancamento|lançamento|gasto|registro)\b/.test(n)
  ) {
    return { kind: 'DELETE_LAST' };
  }

  if (/\b(apaga|apagar|deleta|deletar)\b/.test(n) && /\b(ultimo|último)\b/.test(n)) {
    return { kind: 'DELETE_LAST' };
  }

  if (
    /\b(corrige|corrigir|muda|mudar|altera|alterar|atualiza|atualizar)\b/.test(n) &&
    /\b(ultimo|último)\b/.test(n) &&
    /\b(valor|preco|preço|lancamento|lançamento)\b/.test(n)
  ) {
    const amount = extractMoneyToken(raw);
    if (amount) return { kind: 'UPDATE_LAST_AMOUNT', amount };
  }

  if (
    /\b(corrige|corrigir|muda|mudar|altera|alterar)\b/.test(n) &&
    /\b(ultimo|último)\b/.test(n) &&
    /\b(categoria)\b/.test(n)
  ) {
    const cleaned = raw.replace(
      /\b(corrige|corrigir|muda|mudar|altera|alterar|ultimo|último|categoria|para|pra)\b/giu,
      ' ',
    );
    const hint = cleaned.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    if (hint.length >= 2) return { kind: 'UPDATE_LAST_CATEGORY', categoryHint: hint };
  }

  if (/\b(muda|mudar)\b/.test(n) && /\b(categoria)\b/.test(n) && /\b(para|pra)\b/.test(n)) {
    const parts = raw.split(/\b(para|pra)\b/i);
    const hint = (parts[1] ?? '').trim();
    if (hint.length >= 2) return { kind: 'UPDATE_LAST_CATEGORY', categoryHint: hint };
  }

  return { kind: 'NONE' };
}
