import { normalizeForMatch } from './normalize-text.js';

export function matchesResetUserDataCommand(text: string): boolean {
  const n = normalizeForMatch(text);
  if (n.length > 160) return false;
  if (/\b(ultimo|ultima)\b/.test(n) && /\b(lancamento|registro|gasto)\b/.test(n)) {
    return false;
  }
  if (
    /\b(apagar|apaga|limpar|limpa|resetar|reseta|zerar|zera)\s+todos\s+os\s+dados\b/.test(n) ||
    /\b(apagar|apaga|limpar|limpa)\s+meus\s+dados\b/.test(n) ||
    /\b(apagar|apaga|limpar|limpa)\s+os\s+dados\b/.test(n) ||
    /\b(limpar|limpa|resetar|reseta|zerar|zera)\s+todos\s+os\s+dados\b/.test(n) ||
    /\b(resetar|reseta|limpar|limpa|zerar|zera)\s+minha\s+conta\b/.test(n)
  ) {
    return true;
  }
  if (/\b(apagar|apaga)\s+tudo\b/.test(n)) {
    if (/\b(ultimo|ultima)\b/.test(n)) return false;
    return true;
  }
  return false;
}
