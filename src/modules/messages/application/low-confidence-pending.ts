import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';

export function isAffirmative(text: string): boolean {
  const n = normalizeForMatch(text);
  return /^(sim|s|ok|confirmo|isso|certo|beleza|pode|manda|fecha)\b/.test(n);
}

/** Só encerra pendência com intenção clara de desistir (mensagens curtas). */
export function isExplicitCancellation(text: string): boolean {
  const n = normalizeForMatch(text).trim();
  if (n.length > 36) return false;
  if (/^(nao|não|n)\s*$/u.test(n)) return true;
  if (/^(cancela|cancelar|cancel)\b/u.test(n)) return true;
  if (/^(esquece|esquecer|desisto|desistir)\b/u.test(n)) return true;
  if (/^nao\s+quero\b/u.test(n) || /^não\s+quero\b/u.test(n)) return true;
  if (/^(deixa|para|para ai|para aí)\b/u.test(n)) return true;
  return false;
}

/**
 * Resolve qual categoryId gravar após resposta na pendência LOW_CONFIDENCE_CREATE.
 * Retorna null se a mensagem não for uma confirmação válida.
 */
export function pickCategoryIdForLowConfidenceConfirm(
  text: string,
  suggestedCategoryId: string | null,
  cats: { id: string; normalizedName: string }[],
): string | null {
  if (isAffirmative(text)) return suggestedCategoryId;
  const n = normalizeForMatch(text);
  if (n.length < 2 || n.length > 48) return null;
  if (/\b(recebimentos?|receita|entrada)\b/.test(n)) return suggestedCategoryId;
  if (/\b(despesa|gasto)\b/.test(n) && n.length < 24) return suggestedCategoryId;
  if (suggestedCategoryId) {
    const cat = cats.find((c) => c.id === suggestedCategoryId);
    if (
      cat &&
      (n === cat.normalizedName ||
        n.includes(cat.normalizedName) ||
        cat.normalizedName.includes(n))
    ) {
      return suggestedCategoryId;
    }
  }
  const exact = cats.find((c) => c.normalizedName.length >= 3 && n === c.normalizedName);
  if (exact) return exact.id;
  return null;
}

export function confirmsLowConfidenceCreate(
  text: string,
  suggestedCategoryId: string | null,
  cats: { id: string; normalizedName: string }[],
): boolean {
  return pickCategoryIdForLowConfidenceConfirm(text, suggestedCategoryId, cats) !== null;
}
