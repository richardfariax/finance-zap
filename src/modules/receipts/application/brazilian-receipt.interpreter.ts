import { Decimal } from 'decimal.js';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import type {
  ReceiptConfianca,
  ReceiptInterpretation,
  ReceiptTipo,
} from '../domain/receipt-interpretation.js';

/** Linhas de forma de pagamento / rodapé — nunca são item nem nome do estabelecimento. */
const PAYMENT_OR_FOOTER_LINE =
  /\b(visa|master(card)?|elo|hiper|amex|credi|cr[eé]dito|d[eé]bito|cart[aã]o|parcela(s)?|pagamento|forma\s+de\s+pgto|nsu|autoriza|bandeira|operadora|pix\s*[:]|chave\s*pix|troco|recebido|operac[aã]o|cod\.?\s*auth|autentic)\b/i;

const TOTAL_HINT =
  /\b(valor\s*total|valor\s*a\s*pagar|total\s*a\s*pagar|total\s*geral|total\s+rs|total\s+r\$|^total\s*[:.]?|amount\s*due|a\s*pagar|pagar\s*R\$|l[ií]quido|liquido|vlr\.?\s*total|tot\.?\s*geral|soma\s*geral)\b/i;

/** Variações comuns de OCR em “total”. */
const TOTAL_HINT_LOOSE = /\b(t[o0]ta[l1i]|t[o0]t[a@]is|v[a@]l[o0]r\s*t[o0]ta|t[o0]t\s*[:=])\b/i;

const SUBTOTAL_HINT = /\bsub\s*-?total|subtotal\b/i;

const CNPJ_IN_LINE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;

const DATE_RE = /\b(\d{2})[/.](\d{2})[/.](\d{2,4})\b/g;

/** Produto/combustível típico (ajuda a aceitar linha como item). */
const PRODUCTISH =
  /\b(diesel|gasolina|etanol|gnv|arla|oleo|óleo|lubr|aditiv|s10|s500|comum|aditivada|litro|l\s|kg\s|un\s|cx\s|pct|produto)\b/i;

function toLines(ocrText: string): string[] {
  return ocrText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

function parseBrazilianMoneyToken(raw: string): Decimal | null {
  const t = raw.trim().replace(/^R\$\s*/i, '');
  const normalized = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const d = new Decimal(normalized);
  if (d.lte(0) || d.gt(9_999_999)) return null;
  return d;
}

export function extractMoneyInLine(line: string): { raw: string; value: Decimal }[] {
  const out: { raw: string; value: Decimal }[] = [];
  const seen = new Set<string>();

  const patterns: RegExp[] = [
    /\bR\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)\b/giu,
    /\b([\d]{1,3}(?:\.\d{3})+,\d{2})\b/g,
    /\b(\d+,\d{2})\b(?!\s*\d)/g,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const raw = m[1].replace(/^R\$\s*/i, '');
      const key = `${m.index}:${raw}`;
      if (seen.has(key)) continue;
      const v = parseBrazilianMoneyToken(raw);
      if (!v) continue;
      if (CNPJ_IN_LINE.test(line) && v.lt(100) && raw.length <= 4) continue;
      seen.add(key);
      out.push({ raw, value: v });
    }
  }

  return out;
}

function lineLooksLikeTotalRow(line: string): boolean {
  const low = line.toLowerCase();
  if (SUBTOTAL_HINT.test(low) && !TOTAL_HINT.test(low) && !TOTAL_HINT_LOOSE.test(low)) {
    return false;
  }
  return TOTAL_HINT.test(low) || TOTAL_HINT_LOOSE.test(low);
}

/** Nome que parece lixo de OCR ou linha de tabela (não é produto). */
export function looksLikeOcrGarbageOrTableName(name: string): boolean {
  const t = name.trim();
  if (t.length < 4) return true;
  if (PAYMENT_OR_FOOTER_LINE.test(t)) return true;

  const letters = (t.match(/[a-záàâãéêíóôõúç]/gi) ?? []).length;
  const digits = (t.match(/\d/g) ?? []).length;
  if (letters < 4) return true;
  if (digits >= letters) return true;

  if (/\|\s*\d/.test(t) || /\d\s*\|\s*\d/.test(t)) return true;
  if (/^\d{3,}[\s|]/.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  const noiseShort = words.filter(
    (w) => w.length <= 2 && !/^(de|da|do|e|a|o|b|s|ii|iii)$/i.test(w),
  ).length;
  if (noiseShort >= 3) return true;

  if (/\b(ago|eee|fds|wat|www|http|utf|ascii)\b/i.test(t)) return true;

  const alnum = t.replace(/\s/g, '');
  const digitRatio = digits / Math.max(alnum.length, 1);
  if (digitRatio > 0.35 && !PRODUCTISH.test(t)) return true;

  return false;
}

function detectTipo(fullNorm: string, lines: string[]): ReceiptTipo {
  const blob = `${fullNorm} ${lines.slice(0, 25).join(' ')}`.toLowerCase();

  if (
    /\b(diesel|gasolina|etanol|combust|gnv|posto|shell|ipiranga|petrobras|raizen|arla|litro|bomba)\b/.test(
      blob,
    )
  ) {
    return 'combustivel';
  }
  if (
    /\b(supermercado|hipermercado|atacad|carrefour|pao\s*de\s*acucar|extra\s|walmart|assai|atacadao|mercado)\b/.test(
      blob,
    )
  ) {
    return 'supermercado';
  }
  if (
    /\b(restaurante|lanchonete|padaria|pizz|ifood|rappi|burger|mcdonald|subway|refeicao)\b/.test(
      blob,
    )
  ) {
    return 'restaurante';
  }
  if (/\b(farma|drogaria|drogasil|pacheco|medic)\b/.test(blob)) {
    return 'farmacia';
  }
  if (/\b(recibo|comprovante\s+de\s+pagamento|autentic)\b/.test(blob)) {
    return 'recibo';
  }
  return 'outro';
}

function skipMerchantLine(l: string): boolean {
  const n = l.length;
  if (n < 4 || n > 90) return true;
  if (/^[\d\s./\-:]+$/.test(l)) return true;
  if (CNPJ_IN_LINE.test(l) && n < 48) return true;
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(l.trim())) return true;
  if (/^\d{10,}$/.test(l.replace(/\s/g, ''))) return true;
  if (/cnpj|cpf|ie\s|inscri|endereco|telefone|fone|qrcode/i.test(l) && n < 36) return true;
  if (PAYMENT_OR_FOOTER_LINE.test(l)) return true;
  if (lineLooksLikeTotalRow(l)) return true;
  return false;
}

function guessEstabelecimento(lines: string[]): string {
  const scored: { line: string; score: number }[] = [];

  for (const l of lines.slice(0, 28)) {
    if (skipMerchantLine(l)) continue;
    if (looksLikeOcrGarbageOrTableName(l)) continue;
    const letters = (l.match(/[a-záàâãéêíóôõúç]/gi) ?? []).length;
    if (letters < 5) continue;

    let score = letters;
    if (
      /\b(posto|auto\s*posto|ltda|eireli|\bme\b|cia\.|s\.?\s*a\.?|shell|ipiranga|raizen|petrobras)\b/i.test(
        l,
      )
    ) {
      score += 100;
    }
    if (/\b\d{5,}\b/.test(l)) score -= 25;
    if (/\|/.test(l)) score -= 40;
    scored.push({ line: l, score });
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    return scored[0].line.slice(0, 72).replace(/\s+/g, ' ').trim();
  }

  for (const l of lines) {
    if (skipMerchantLine(l) || PAYMENT_OR_FOOTER_LINE.test(l)) continue;
    const letters = (l.match(/[a-záàâãéêíóôõúç]/gi) ?? []).length;
    if (letters >= 8 && !looksLikeOcrGarbageOrTableName(l)) {
      return l.slice(0, 72).replace(/\s+/g, ' ').trim();
    }
  }

  return 'Comprovante';
}

function findDateString(fullText: string): string {
  DATE_RE.lastIndex = 0;
  const matches = [...fullText.matchAll(DATE_RE)];
  if (matches.length === 0) return '';

  const [, d, mo, y] = matches[matches.length - 1];
  let year: string = y.length === 2 ? `20${y}` : y;
  if (year.length === 2) year = `20${year}`;
  return `${d}/${mo}/${year}`;
}

export function parseReceiptDateToIso(dateStr: string, fallback: Date): Date {
  if (!dateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return fallback;
  const [d, m, y] = dateStr.split('/').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? fallback : dt;
}

/**
 * `occurredAt` ao confirmar cupom pelo WhatsApp: **dia em que a foto/mensagem chegou**
 * no fuso do usuário (meio-dia local). A data impressa no papel costuma estar certa
 * para o consumo, mas o OCR muitas vezes captura dia diferente ou o usuário envia dias
 * depois — aí o lançamento sumia do “resumo de hoje”.
 */
export function resolveReceiptOccurredAtUtc(
  _receiptDateStr: string,
  receivedAtUtc: Date,
  userTimezone: string,
): Date {
  const anchorKey = formatInTimeZone(receivedAtUtc, userTimezone, 'yyyy-MM-dd');
  const [yA, mA, dA] = anchorKey.split('-').map(Number);
  return fromZonedTime(new Date(yA, mA - 1, dA, 12, 0, 0, 0), userTimezone);
}

function categoriaFromTipo(tipo: ReceiptTipo): string {
  switch (tipo) {
    case 'combustivel':
      return 'Transporte';
    case 'supermercado':
      return 'Mercado';
    case 'restaurante':
      return 'Alimentação';
    case 'farmacia':
      return 'Saúde';
    case 'recibo':
    case 'outro':
    default:
      return 'Outros';
  }
}

/** Se só há um valor grande na linha e parece fechamento, conta como total explícito. */
function totalFromUniqueLargeAmountLine(
  lines: string[],
  globalMax: Decimal,
): { value: Decimal; seen: boolean } | null {
  if (!globalMax.gt(0)) return null;
  const tol = new Decimal('0.03');
  for (const line of lines) {
    if (PAYMENT_OR_FOOTER_LINE.test(line)) continue;
    const amts = extractMoneyInLine(line);
    if (amts.length !== 1) continue;
    const [only] = amts;
    const v = only.value;
    if (!v.minus(globalMax).abs().lte(tol)) continue;
    const low = line.toLowerCase();
    if (lineLooksLikeTotalRow(line)) return { value: v, seen: true };
    if (only.value.gte(100) && line.length < 72 && !PRODUCTISH.test(line)) {
      if (/\b(pag|total|geral|pagar|rs|r\$)\b/i.test(low)) return { value: v, seen: true };
    }
  }
  return null;
}

export function interpretBrazilianReceipt(ocrText: string): ReceiptInterpretation {
  const lines = toLines(ocrText);
  const fullText = lines.join('\n');
  const fullNorm = normalizeForMatch(fullText);

  const tipo = detectTipo(fullNorm, lines);
  const dataStr = findDateString(fullText);

  const allAmounts: Decimal[] = [];
  for (const line of lines) {
    const letters = (line.match(/[a-záàâãéêíóôõúç]/gi) ?? []).length;
    if (letters < 2 && CNPJ_IN_LINE.test(line)) continue;
    for (const { value } of extractMoneyInLine(line)) {
      allAmounts.push(value);
    }
  }

  const reasonable = allAmounts.filter((v) => v.gte(0.01) && v.lte(500_000));
  const maxFallback =
    reasonable.length > 0 ? reasonable.reduce((a, b) => (a.gt(b) ? a : b)) : new Decimal(0);

  let totalExplicit: Decimal | null = null;
  let totalLineSeen = false;

  for (const line of lines) {
    const low = line.toLowerCase();
    if (SUBTOTAL_HINT.test(low) && !lineLooksLikeTotalRow(line)) continue;
    if (!lineLooksLikeTotalRow(line)) continue;
    totalLineSeen = true;
    const amounts = extractMoneyInLine(line);
    if (amounts.length === 0) continue;
    const maxOnLine = amounts.reduce((a, b) => (a.value.gt(b.value) ? a : b));
    if (!totalExplicit || maxOnLine.value.gt(totalExplicit)) {
      totalExplicit = maxOnLine.value;
    }
  }

  if (!totalExplicit && maxFallback.gt(0)) {
    const hint = totalFromUniqueLargeAmountLine(lines, maxFallback);
    if (hint) {
      totalExplicit = hint.value;
      totalLineSeen = hint.seen;
    }
  }

  const valorTotal = totalExplicit ?? (reasonable.length > 0 ? maxFallback : new Decimal(0));
  const estabelecimento = guessEstabelecimento(lines);

  let confianca: ReceiptConfianca = 'baixa';
  const observacoesParts: string[] = [];

  if (totalExplicit) {
    confianca = totalLineSeen ? 'alta' : 'media';
  } else if (valorTotal.gt(0)) {
    confianca = 'media';
    observacoesParts.push('Total estimado pelo maior valor legível (sem linha TOTAL clara).');
  }

  if (tipo !== 'outro' && valorTotal.gt(0)) {
    confianca = confianca === 'baixa' ? 'media' : confianca;
  }

  let merchant = estabelecimento;
  if (looksLikeOcrGarbageOrTableName(merchant)) {
    merchant = 'Comprovante (nome ilegível no cupom)';
  }

  return {
    tipo,
    estabelecimento: merchant,
    data: dataStr,
    valor_total: Number(valorTotal.toFixed(2)),
    itens: [],
    categoria_sugerida: categoriaFromTipo(tipo),
    observacoes: observacoesParts.join(' ').trim(),
    confianca,
  };
}
