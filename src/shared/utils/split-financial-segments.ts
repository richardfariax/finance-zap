/**
 * Divide uma mensagem em vários trechos por vírgula.
 * Vírgulas dentro de valores em PT-BR (ex.: 23,50 ou 1.234,56) são preservadas.
 */
const MONEY_TOKEN =
  /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+,\d{2}\b/giu;

const PLACEHOLDER_START = '\uE000';
const PLACEHOLDER_END = '\uE001';

export function splitFinancialSegments(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized.includes(',')) {
    return [normalized];
  }

  const vault: string[] = [];
  const masked = normalized.replace(MONEY_TOKEN, (match) => {
    const id = vault.length;
    vault.push(match);
    return `${PLACEHOLDER_START}${String(id)}${PLACEHOLDER_END}`;
  });

  const parts = masked.split(',');
  const restored = parts.map((part) =>
    part.replace(
      new RegExp(`${PLACEHOLDER_START}(\\d+)${PLACEHOLDER_END}`, 'gu'),
      (_, idx) => vault[Number(idx)] ?? '',
    ),
  );

  return restored.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Trecho que é só valor monetário (ou inteiro), sem descrição de lançamento. */
export function isMoneyOnlySegment(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})(?:\s*(?:reais?|real))?$/iu.test(t)) {
    return true;
  }
  if (/^(?:R\$\s*)?\d+(?:,\d{2})?(?:\s*(?:reais?|real))?$/iu.test(t)) {
    return true;
  }
  return /^\d+$/u.test(t);
}
