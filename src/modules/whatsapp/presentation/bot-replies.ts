import { Decimal } from 'decimal.js';
import type {
  DailySummary,
  MonthlySummary,
  CategoryBreakdownRow,
} from '../../reports/application/reports.service.js';
import type { Transaction } from '@prisma/client';
import type { TransactionType } from '../../../shared/types/prisma-enums.js';
import type { ReceiptInterpretation } from '../../receipts/domain/receipt-interpretation.js';
import { userFacingOccurrenceLabel } from '../../../shared/utils/user-facing-date.js';
import { FZ_TAGLINE, fzSection } from './bot-voice.js';

const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(d: Decimal): string {
  return moneyFmt.format(Number(d.toFixed(2)));
}

function titleCasePt(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
}

export const TRANSACTION_TYPE_CHOICE_PHRASE = 'despesa, receita ou transferência';

export function replyParserNeedValueOnly(): string {
  return [fzSection('⚠️', 'Valor ausente'), 'Indique o valor:', '', '• 45,90', '• 120'].join('\n');
}

export function replyParserUnknownWithExamples(): string {
  return [
    fzSection('⚠️', 'Não entendi'),
    'Exemplos:',
    '',
    '• mercado 50',
    '• uber 25',
    '• recebi 1000',
    '• uber 10',
    '• mercado 40',
  ].join('\n');
}

export function replyParserCorrectionNotLancamento(): string {
  return [
    fzSection('⚠️', 'Ajuste de lançamento'),
    'Para corrigir o valor:',
    '• corrige o último para 59,90',
    '',
    'Para apagar:',
    '• apaga o último lançamento',
  ].join('\n');
}

export function replyMoneyOnlyNotLancamento(): string {
  return [
    fzSection('⚠️', 'Falta o contexto'),
    'Inclua o nome ou tipo do gasto:',
    '',
    '• uber 23,50',
    '• recebi 500',
  ].join('\n');
}

export function replyParserAskTransactionKind(): string {
  return [
    fzSection('⚠️', 'Tipo de lançamento'),
    `Responda com uma palavra: ${TRANSACTION_TYPE_CHOICE_PHRASE}.`,
    '',
    'despesa — saída de dinheiro',
    'receita — entrada de dinheiro',
    'transferência — entre suas contas',
  ].join('\n');
}

/** Opções de resposta na confirmação de lançamento com categoria incerta (reutilizado nas mensagens do fluxo). */
export function lowConfidenceCategoryReplyHints(): string {
  return [
    'Como responder:',
    '',
    '• *sim* — confirmar e salvar do jeito que está',
    '• *nome de uma categoria* — trocar a categoria (ex.: mercado, salário)',
    '• *quais categorias* — ver a lista completa',
    '• *cancelar* — nada é salvo',
  ].join('\n');
}

export function replyParserSuggestCategoryName(
  categoryName: string | null,
  amount: Decimal,
  transactionType: TransactionType,
): string {
  const cat = categoryName ?? 'Outros';
  const kindLabelPt =
    transactionType === 'EXPENSE'
      ? 'Gasto'
      : transactionType === 'INCOME'
        ? 'Receita'
        : 'Transferência';
  return [
    '*Confirmação*',
    '',
    `💸 ${formatMoney(amount)}`,
    `🏷️ ${cat}`,
    `Tipo: ${kindLabelPt}`,
    '',
    lowConfidenceCategoryReplyHints(),
  ].join('\n');
}

export function replyCompoundBatchIntro(count: number): string {
  const n = count === 1 ? '1 item' : `${String(count)} itens`;
  return [
    fzSection('📋', 'Vários lançamentos'),
    `Encontrados ${n} (separados por vírgula).`,
    'Confirmação um a um. Responda cada etapa antes de continuar.',
  ].join('\n');
}

export function replyCompoundStoppedForConfirmation(remaining: number): string {
  const r = remaining === 1 ? '1 pendente' : `${String(remaining)} pendentes`;
  return [
    fzSection('⏸️', 'Aguardando resposta'),
    `Faltam ${r}.`,
    'Responda à mensagem anterior.',
  ].join('\n');
}

export function replyAskReportScope(): string {
  return [fzSection('📊', 'Resumo'), 'Qual período?', '', '• hoje', '• mês'].join('\n');
}

export function replyReportScopeUnclear(): string {
  return [fzSection('📊', 'Resumo'), 'Responda:', '', '• hoje', '• mês'].join('\n');
}

export function replyExpenseRegistered(
  amount: Decimal,
  place: string,
  category: string,
  _occurredLabel: string,
  dayBalance?: Decimal | null,
): string {
  const money = formatMoney(amount);
  const lines = ['✅ *Gasto registrado*', '', `💸 ${money}`, `🏷️ ${category}`, '', `📌 ${place}`];
  if (dayBalance != null) {
    lines.push('', `📊 Saldo: ${formatMoney(dayBalance)}`);
  }
  return lines.join('\n');
}

export function replyIncomeRegistered(
  amount: Decimal,
  label: string,
  _occurredLabel: string,
  dayBalance?: Decimal | null,
): string {
  const money = formatMoney(amount);
  const lines = ['✅ *Receita registrada*', '', `💵 ${money}`, '', `📌 ${label}`];
  if (dayBalance != null) {
    lines.push('', `📊 Saldo: ${formatMoney(dayBalance)}`);
  }
  return lines.join('\n');
}

export function replyTransferRegistered(
  amount: Decimal,
  label: string,
  _occurredLabel: string,
  dayBalance?: Decimal | null,
): string {
  const money = formatMoney(amount);
  const lines = ['✅ *Transferência registrada*', '', `↔️ ${money}`, '', `📌 ${label}`];
  if (dayBalance != null) {
    lines.push('', `📊 Saldo: ${formatMoney(dayBalance)}`);
  }
  return lines.join('\n');
}

export function replyMonthlySummary(s: MonthlySummary): string {
  return [
    fzSection('📊', 'Resumo do mês'),
    s.monthLabel,
    '',
    `💵 Entradas ${formatMoney(s.income)}`,
    `💸 Saídas ${formatMoney(s.expense)}`,
    `⚖️ Saldo ${formatMoney(s.balance)}`,
  ].join('\n');
}

export function replyMonthLedger(
  current: MonthlySummary,
  previous: MonthlySummary,
  breakdown: CategoryBreakdownRow[],
): string {
  const deltaExp = current.expense.minus(previous.expense);
  let comparativo: string;
  if (deltaExp.isZero()) {
    comparativo = 'Saídas iguais às do mês anterior.';
  } else if (deltaExp.gt(0)) {
    comparativo = `Variação nas saídas: ${formatMoney(deltaExp.abs())} a mais que no mês anterior.`;
  } else {
    comparativo = `Variação nas saídas: ${formatMoney(deltaExp.abs())} a menos que no mês anterior.`;
  }

  const lines: string[] = [
    fzSection('📊', 'Mês atual'),
    current.monthLabel,
    '',
    `💵 Entradas ${formatMoney(current.income)}`,
    `💸 Saídas ${formatMoney(current.expense)}`,
    `⚖️ Saldo ${formatMoney(current.balance)}`,
    '',
    fzSection('📊', 'Mês anterior'),
    `Saídas: ${formatMoney(previous.expense)}`,
    comparativo,
  ];

  if (breakdown.length > 0) {
    lines.push('', fzSection('📂', 'Gastos por categoria'));
    breakdown.slice(0, 8).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} — ${formatMoney(r.total)}`);
    });
  } else {
    lines.push('', 'Sem gastos por categoria neste mês.');
  }

  return lines.join('\n');
}

export function replyTodayLedger(
  day: DailySummary,
  breakdown: CategoryBreakdownRow[],
  top: Transaction[],
): string {
  const wd = titleCasePt(day.weekdayLabel);
  if (day.income.isZero() && day.expense.isZero()) {
    return [
      fzSection('📊', 'Resumo do dia'),
      `${wd}, ${day.dayLabel}`,
      '',
      'Nenhum lançamento.',
      '',
      'Exemplos:',
      '',
      '• uber 15',
      '• almoço 35',
    ].join('\n');
  }

  const lines: string[] = [
    fzSection('📊', 'Resumo do dia'),
    `${wd}, ${day.dayLabel}`,
    '',
    `💵 Entradas ${formatMoney(day.income)}`,
    `💸 Saídas ${formatMoney(day.expense)}`,
    `⚖️ Saldo ${formatMoney(day.balance)}`,
  ];

  if (breakdown.length > 0) {
    lines.push('', fzSection('📂', 'Gastos por categoria'));
    breakdown.slice(0, 8).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} — ${formatMoney(r.total)}`);
    });
  }

  if (top.length > 0) {
    lines.push('', fzSection('📋', 'Maiores gastos'));
    top.forEach((t, i) => {
      const amt = new Decimal(t.amount.toString());
      lines.push(`${String(i + 1)}. ${t.description.slice(0, 38)} — ${formatMoney(amt)}`);
    });
  }

  return lines.join('\n');
}

export function replyCategoryBreakdown(rows: CategoryBreakdownRow[]): string {
  if (rows.length === 0) {
    return [fzSection('📂', 'Gastos por categoria'), 'Nenhum gasto registrado no mês.'].join('\n');
  }
  const top = rows.slice(0, 8);
  return [
    fzSection('📂', 'Gastos por categoria'),
    'Mês atual — por valor',
    '',
    ...top.map((r, i) => `${String(i + 1)}. ${r.categoryName} — ${formatMoney(r.total)}`),
  ].join('\n');
}

export function replyTopExpenses(txs: Transaction[]): string {
  if (txs.length === 0) {
    return [fzSection('📋', 'Maiores gastos'), 'Nenhum lançamento no mês.'].join('\n');
  }
  return [
    fzSection('📋', 'Maiores gastos'),
    'Mês atual',
    '',
    ...txs.map(
      (t, i) =>
        `${String(i + 1)}. ${t.description.slice(0, 40)} — ${formatMoney(new Decimal(t.amount.toString()))}`,
    ),
  ].join('\n');
}

export function replyLatestTransactions(txs: Transaction[]): string {
  if (txs.length === 0) {
    return [fzSection('📋', 'Últimos lançamentos'), 'Nenhum lançamento.'].join('\n');
  }
  return [
    fzSection('📋', 'Últimos lançamentos'),
    'Do mais recente ao mais antigo',
    '',
    ...txs.map((t) => {
      const icon = t.type === 'INCOME' ? '➕' : t.type === 'EXPENSE' ? '➖' : '↔️';
      return `${icon} ${formatMoney(new Decimal(t.amount.toString()))} — ${t.description.slice(0, 36)}`;
    }),
  ].join('\n');
}

export function replyRecurring(
  list: { description: string; frequency: string; amount: string | null }[],
): string {
  if (list.length === 0) {
    return [
      fzSection('🔁', 'Possíveis despesas fixas'),
      'Dados insuficientes para sugestões.',
    ].join('\n');
  }
  return [
    fzSection('🔁', 'Possíveis despesas fixas'),
    'Estimativa automática — confira no seu banco.',
    '',
    ...list
      .slice(0, 8)
      .map((r) => `• ${r.description} (${r.frequency})${r.amount ? ` — ${r.amount}` : ''}`),
  ].join('\n');
}

/** Resposta curta a cumprimentos (quem já recebeu a boas-vindas completa). */
export function replyIntro(): string {
  return [
    fzSection('👋', 'Finance Zap'),
    FZ_TAGLINE,
    '',
    'Ex.: uber 23,50 · recebi 1500 · dia 10 pagar conta · amanhã 15h dentista',
    '',
    'Comandos: *ajuda* · *resumo* · *agenda*',
  ].join('\n');
}

export function replyWelcome(): string {
  return replyIntro();
}

export function replyHelp(): string {
  return [
    fzSection('📘', 'Ajuda'),
    FZ_TAGLINE,
    '',
    '*Gastos e entradas*',
    '',
    '• uber 20',
    '• mercado 100',
    '• recebi 800',
    '• lanche 25',
    '',
    '*Agenda e lembretes*',
    '',
    '• amanhã às 14h reunião com o cliente',
    '• dia 10 pagar aluguel',
    '• daqui 30 minutos ligar para o João',
    '• agenda',
    '• agenda de hoje',
    '• cancelar lembrete do aluguel',
    '',
    '*Consultar finanças*',
    '',
    '• resumo (depois: hoje ou mês)',
    '• quanto gastei hoje',
    '• últimos lançamentos',
    '• onde gastei mais',
    '',
    '*Corrigir lançamento*',
    '',
    '• corrige o último para 59,90',
    '• muda a categoria do último para mercado',
    '• apaga o último lançamento',
    '',
    '*Apagar todos os dados*',
    '',
    '• apagar todos os dados',
    '',
    'Remove também lembretes e agenda. Irreversível.',
    '',
    '*Áudio e foto*',
    '',
    'Áudio transcrito ou cupom lido. Confirmação com sim antes de gravar.',
  ].join('\n');
}

export function replyAccountDataWiped(): string {
  return [
    fzSection('✅', 'Dados apagados'),
    'Lançamentos, lembretes, categorias personalizadas, regras e histórico foram removidos.',
    '',
    'Esta ação não pode ser desfeita.',
  ].join('\n');
}

/** O parser já inclui `lowConfidenceCategoryReplyHints` na confirmação; não repetir o rodapé. */
export function extendLowConfidenceClarification(clarification: string): string {
  return clarification.trim();
}

export function replyPendingLowConfidenceReminder(): string {
  return [
    fzSection('⏳', 'Aguardando resposta'),
    'Ainda preciso da sua confirmação sobre o lançamento anterior.',
    '',
    lowConfidenceCategoryReplyHints(),
  ].join('\n');
}

function categoryListIntroForType(transactionType: TransactionType): string {
  if (transactionType === 'EXPENSE') return fzSection('📂', 'Categorias de gasto');
  if (transactionType === 'INCOME') return fzSection('📂', 'Categorias de receita');
  return fzSection('📂', 'Categorias');
}

export function replyCategoryOptionsWhilePending(
  categoryNames: string[],
  transactionType: TransactionType | null,
): string {
  const lines = categoryNames.map((name) => `• ${name}`);
  const intro = transactionType
    ? categoryListIntroForType(transactionType)
    : fzSection('📂', 'Categorias');
  return [intro, '', ...lines, '', lowConfidenceCategoryReplyHints()].join('\n');
}

export function replyCategoryOptionsForLastTransaction(
  categoryNames: string[],
  transactionType: TransactionType,
): string {
  const lines = categoryNames.map((name) => `• ${name}`);
  return [
    categoryListIntroForType(transactionType),
    '',
    ...lines,
    '',
    'Envie: muda a categoria do último para (nome)',
  ].join('\n');
}

export function replySoftUnknown(): string {
  return [
    fzSection('⚠️', 'Não entendi'),
    'Descreva um gasto ou receita com valor, um lembrete com data, ou use:',
    '',
    '• resumo',
    '• agenda',
    '• ajuda',
  ].join('\n');
}

export function replyAudioTranscriptionPreview(transcribedText: string): string {
  const clip =
    transcribedText.length > 180
      ? `${transcribedText.slice(0, 177).trim()}…`
      : transcribedText.trim();
  return [
    fzSection('🎤', 'Transcrição'),
    `"${clip}"`,
    '',
    'Responda sim para registrar, não para descartar.',
    'Novo áudio ou texto substitui esta mensagem.',
  ].join('\n');
}

export function replyTranscriptionEmpty(): string {
  return [
    fzSection('⚠️', 'Áudio ilegível'),
    'Tente novamente com o microfone mais próximo ou ambiente silencioso.',
    'Você pode enviar a mesma informação em texto.',
  ].join('\n');
}

export function replyNoTextInMessage(): string {
  return [
    fzSection('⚠️', 'Sem conteúdo'),
    'Envie texto, áudio ou foto de cupom com valor legível.',
  ].join('\n');
}

export function replyClarifyTransactionTypeAgain(): string {
  return [fzSection('⚠️', 'Tipo obrigatório'), 'Responda: despesa, receita ou transferência.'].join(
    '\n',
  );
}

export function replyCancelLowConfidence(): string {
  return [fzSection('✅', 'Cancelado'), 'Nada foi salvo.'].join('\n');
}

export function replyInvalidPendingContext(): string {
  return [fzSection('⚠️', 'Sessão expirada'), 'Envie o lançamento novamente.'].join('\n');
}

export function replyLastTxNotFound(): string {
  return [fzSection('⚠️', 'Sem lançamento recente'), 'Não há registro para alterar.'].join('\n');
}

export function replyLastTxDeleteFail(): string {
  return [fzSection('⚠️', 'Falha ao apagar'), 'Tente novamente em instantes.'].join('\n');
}

export function replyLastTxDeleted(): string {
  return [fzSection('✅', 'Lançamento removido')].join('\n');
}

export function replyLastTxAmountFail(): string {
  return [fzSection('⚠️', 'Valor não alterado'), 'Tente novamente.'].join('\n');
}

export function replyLastTxAmountNeedsValue(): string {
  return [
    fzSection('⚠️', 'Valor necessário'),
    'Exemplo:',
    '',
    '• corrige o último para 59,90',
  ].join('\n');
}

export function replyLastTxAmountUpdated(amount: Decimal): string {
  return ['✅ *Valor atualizado*', '', `💸 ${formatMoney(amount)}`].join('\n');
}

export function replyLastTxCategoryNotFound(): string {
  return [fzSection('⚠️', 'Categoria inexistente'), 'Use: quais categorias'].join('\n');
}

export function replyLastTxCategoryUpdateFail(): string {
  return [fzSection('⚠️', 'Categoria não alterada'), 'Tente novamente.'].join('\n');
}

export function replyLastTxCategoryUpdated(categoryName: string): string {
  return ['✅ *Categoria atualizada*', '', `🏷️ ${categoryName}`].join('\n');
}

export function firstNameFromPush(pushName: string | null | undefined): string {
  const t = (pushName ?? '').trim();
  if (!t) return 'amigo';
  const w = (t.split(/\s+/)[0] ?? t).trim();
  const clean = w.replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return 'amigo';
  return titleCasePt(clean.toLowerCase());
}

/** Primeira mensagem do usuário: uma única resposta, mais completa. */
export function replyOnboardingWelcome(displayName: string): string {
  return [
    `Olá, *${displayName}*`,
    '',
    'Sou seu assistente aqui no WhatsApp para você *anotar gastos e entradas*, ver *resumo* do dia ou do mês e ainda *marcar lembretes e compromissos* (reunião, conta a pagar, horário) — tudo em texto ou áudio, sem planilha.',
    '',
    fzSection('👋', 'Finance Zap'),
    FZ_TAGLINE,
    '',
    'Exemplos:',
    '',
    '• uber 23,50',
    '• recebi 1500',
    '• amanhã às 14h reunião com Ana',
    '• dia 10 pagar aluguel',
    '',
    'Para orientação completa, digite *ajuda* · *resumo* · *agenda*',
  ].join('\n');
}

export function replyAutomatedDaySummary(
  day: DailySummary,
  topCategories: CategoryBreakdownRow[],
): string {
  const wd = titleCasePt(day.weekdayLabel);
  if (day.income.isZero() && day.expense.isZero()) {
    return [fzSection('📊', 'Resumo de ontem'), wd, '', 'Nenhum lançamento.'].join('\n');
  }
  const lines: string[] = [
    fzSection('📊', 'Resumo de ontem'),
    wd,
    '',
    `💸 Saídas ${formatMoney(day.expense)}`,
    `💵 Entradas ${formatMoney(day.income)}`,
    `⚖️ Saldo ${formatMoney(day.balance)}`,
  ];
  const top = topCategories.filter((r) => r.total.gt(0)).slice(0, 3);
  if (top.length > 0) {
    lines.push('', fzSection('📂', 'Gastos por categoria'));
    top.forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} — ${formatMoney(r.total)}`);
    });
  }
  return lines.join('\n');
}

export function replyPinConversationNudge(): string {
  return [
    fzSection('📌', 'Fixar conversa'),
    'Assim você não perde o resumo automático.',
    '',
    'Android: menu da conversa → Fixar',
    'iPhone: deslizar a conversa → Fixar',
  ].join('\n');
}

export function replyReceiptOcrPreview(r: ReceiptInterpretation): string {
  const total = formatMoney(new Decimal(String(r.valor_total)));
  const place = r.estabelecimento.slice(0, 44);
  const lines = [
    '✅ *Cupom lido*',
    '',
    `📌 ${place}`,
    `💸 ${total}`,
    `🏷️ ${r.categoria_sugerida}`,
    '',
    'Responda *sim* para salvar ou *não* para descartar.',
  ];
  return lines.join('\n');
}

export function replyReceiptOcrDismissed(): string {
  return [fzSection('✅', 'Cupom descartado'), 'Envie texto ou outra foto quando quiser.'].join(
    '\n',
  );
}

export function occurrenceLabelForReply(occurredAt: Date, now: Date, timeZone: string): string {
  return userFacingOccurrenceLabel(occurredAt, now, timeZone);
}
