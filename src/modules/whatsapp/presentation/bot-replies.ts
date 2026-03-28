import { Decimal } from 'decimal.js';
import type {
  DailySummary,
  MonthlySummary,
  CategoryBreakdownRow,
} from '../../reports/application/reports.service.js';
import type { Transaction, TransactionType } from '@prisma/client';

const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(d: Decimal): string {
  return moneyFmt.format(Number(d.toFixed(2)));
}

function titleCasePt(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
}

export function replyExpenseRegistered(amount: Decimal, place: string, category: string): string {
  return `Pronto! Registrei *${formatMoney(amount)}* em “${place}” (${category}). Se quiser mudar a categoria, é só falar.`;
}

export function replyIncomeRegistered(amount: Decimal, label: string): string {
  return `Feito! Entrou *${formatMoney(amount)}* — ${label}.`;
}

export function replyTransferRegistered(amount: Decimal, label: string): string {
  return `Anotado: *${formatMoney(amount)}* (${label}).`;
}

/** @deprecated Prefer replyMonthLedger; mantido para compat. */
export function replyMonthlySummary(s: MonthlySummary): string {
  return `No mês de *${s.monthLabel}*: receitas ${formatMoney(s.income)}, despesas ${formatMoney(s.expense)}, saldo ${formatMoney(s.balance)}.`;
}

export function replyMonthLedger(
  current: MonthlySummary,
  previous: MonthlySummary,
  breakdown: CategoryBreakdownRow[],
): string {
  const deltaExp = current.expense.minus(previous.expense);
  let comparativo: string;
  if (deltaExp.isZero()) {
    comparativo = 'No mesmo patamar de despesas do mês anterior.';
  } else if (deltaExp.gt(0)) {
    comparativo = `*${formatMoney(deltaExp.abs())}* a mais em despesas que no mês anterior.`;
  } else {
    comparativo = `*${formatMoney(deltaExp.abs())}* a menos em despesas que no mês anterior.`;
  }

  const lines: string[] = [
    '📅 *Levantamento do mês*',
    `_${current.monthLabel}_`,
    '',
    '*Resumo financeiro*',
    `• Receitas · *${formatMoney(current.income)}*`,
    `• Despesas · *${formatMoney(current.expense)}*`,
    `• Saldo (R − D) · *${formatMoney(current.balance)}*`,
    '',
    '*Comparativo*',
    `• Despesas no mês anterior · ${formatMoney(previous.expense)}`,
    `• ${comparativo}`,
  ];

  if (breakdown.length > 0) {
    lines.push('', '*Despesas por categoria*');
    breakdown.slice(0, 10).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} · *${formatMoney(r.total)}*`);
    });
  } else {
    lines.push('', '_Nenhuma despesa categorizada neste mês._');
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
      '📊 *Seu dia*',
      `_${wd}, ${day.dayLabel}_`,
      '',
      '_Não há lançamentos registrados para hoje no seu fuso._',
      '',
      'Quando anotar gastos ou receitas, o resumo aparece aqui.',
    ].join('\n');
  }

  const lines: string[] = [
    '📊 *Levantamento do dia*',
    `_${wd}, ${day.dayLabel}_`,
    '',
    '*Resumo*',
    `• Receitas · *${formatMoney(day.income)}*`,
    `• Despesas · *${formatMoney(day.expense)}*`,
    `• Saldo do dia · *${formatMoney(day.balance)}*`,
  ];

  if (breakdown.length > 0) {
    lines.push('', '*Despesas por categoria*');
    breakdown.slice(0, 10).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} · *${formatMoney(r.total)}*`);
    });
  }

  if (top.length > 0) {
    lines.push('', '*Maiores despesas do dia*');
    top.forEach((t, i) => {
      const amt = new Decimal(t.amount.toString());
      lines.push(`${String(i + 1)}. ${t.description.slice(0, 38)} · *${formatMoney(amt)}*`);
    });
  }

  return lines.join('\n');
}

export function replyCategoryBreakdown(rows: CategoryBreakdownRow[]): string {
  if (rows.length === 0) return 'Ainda não há despesas categorizadas neste mês.';
  const top = rows.slice(0, 5);
  const parts = top.map((r) => `${r.categoryName} (${formatMoney(r.total)})`);
  return `Onde mais saiu dinheiro: ${parts.join(', ')}.`;
}

export function replyTopExpenses(txs: Transaction[]): string {
  if (txs.length === 0) return 'Sem despesas no período.';
  const lines = txs.map(
    (t, i) =>
      `${String(i + 1)}. ${t.description.slice(0, 40)} — ${formatMoney(new Decimal(t.amount.toString()))}`,
  );
  return `Maiores gastos:\n${lines.join('\n')}`;
}

export function replyLatestTransactions(txs: Transaction[]): string {
  if (txs.length === 0) return 'Nenhum lançamento ainda por aqui.';
  const lines = txs.map((t) => {
    return `• ${t.type} ${formatMoney(new Decimal(t.amount.toString()))} — ${t.description.slice(0, 36)}`;
  });
  return `Últimos lançamentos:\n${lines.join('\n')}`;
}

export function replyRecurring(
  list: { description: string; frequency: string; amount: string | null }[],
): string {
  if (list.length === 0) return 'Ainda não peguei um padrão bem claro de recorrência.';
  const lines = list
    .slice(0, 8)
    .map((r) => `• ${r.description} (${r.frequency})${r.amount ? ` ~ ${r.amount}` : ''}`);
  return `Coisas que parecem repetir:\n${lines.join('\n')}`;
}

export function replyIntro(): string {
  return [
    'Oi! Sou o *Finance Zap* — te ajudo a anotar grana sem planilha.',
    '',
    'Manda em texto ou *áudio*, tipo:',
    '• *uber 23,50* ou *gastei 40 no mercado*',
    '• *recebi 50 de fulano*',
    '',
    'Perguntas: *quanto gastei hoje?* · *quanto gastei esse mês?* · *ajuda*',
    '',
    'Pode mandar o que precisar.',
  ].join('\n');
}

export function replyWelcome(): string {
  return replyIntro();
}

export function replyHelp(): string {
  return [
    '📘 *Finance Zap — Central de ajuda*',
    '',
    'Use frases naturais em português. Exemplos abaixo são só guia; variações parecidas costumam funcionar.',
    '',
    '━━ *1. Despesas (gastos)* ━━',
    '• `uber 23,50`',
    '• `gastei 45 no mercado hoje`',
    '• `paguei 120 pra fulana referente ao jantar`',
    '',
    '━━ *2. Receitas* ━━',
    '• `recebi 2500 de salário`',
    '• `recebi 80 de fulano`',
    '',
    '━━ *3. Relatórios e consultas* ━━',
    '• `quanto gastei hoje?` — resumo do dia',
    '• `quanto gastei esse mês?` / `resumo do mês` — levantamento mensal',
    '• `onde estou gastando mais?` — por categoria (mês atual)',
    '• `últimos lançamentos` — extrato recente',
    '',
    '━━ *4. Ajustar o último lançamento* ━━',
    '• `apaga o último`',
    '• `corrige o último para 59,90`',
    '• `muda a categoria do último para alimentação`',
    '',
    '━━ *5. Áudio e imagem* ━━',
    '• *Áudio*: transcrevo o que disser e peço *sim* para confirmar antes de salvar.',
    '• *Foto* de cupom ou print com valor legível.',
    '',
    'Dúvidas pontuais: pergunte de novo ou reformule a frase.',
  ].join('\n');
}

/** Uma única mensagem no fluxo de confirmação de categoria (evita duplicar instruções). */
export function extendLowConfidenceClarification(clarification: string): string {
  return [
    clarification.trim(),
    '',
    '_Opcional:_ *quais categorias* — ver nomes · *cancelar* — desistir sem salvar.',
  ].join('\n');
}

export function replyPendingLowConfidenceReminder(): string {
  return [
    'Esse lançamento continua *pendente*: responda *sim* pra confirmar a categoria sugerida, ou mande o *nome* de outra categoria.',
    '',
    '*Quais categorias* — lista · *cancelar* — não salvar.',
  ].join('\n');
}

function categoryListIntroForType(transactionType: TransactionType): string {
  if (transactionType === 'EXPENSE') return 'Pra esta *despesa*, você pode usar:';
  if (transactionType === 'INCOME') return 'Pra esta *receita*, você pode usar:';
  return 'Pra esta *transferência*, costuma encaixar numa destas:';
}

/** Lista nomes de categorias enquanto o usuário confirma ou escolhe categoria em um lançamento pendente. */
export function replyCategoryOptionsWhilePending(
  categoryNames: string[],
  transactionType: TransactionType | null,
): string {
  const lines = categoryNames.map((name) => `• ${name}`);
  const intro = transactionType
    ? categoryListIntroForType(transactionType)
    : 'Estas são as *categorias* que você pode usar:';
  return [
    intro,
    '',
    ...lines,
    '',
    'Se a sugestão anterior estiver certa, manda *sim*. Se for outra, manda só o *nome* da categoria.',
  ].join('\n');
}

/** Lista categorias ao ajustar o último lançamento quando o usuário pergunta quais existem. */
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
    'Para aplicar: *muda a categoria do último para (nome)*.',
  ].join('\n');
}

export function replySoftUnknown(): string {
  return [
    'Não consegui entender essa mensagem.',
    '',
    'Exemplos de lançamento:',
    '• *recebi 50 de fulano*',
    '• *paguei 120 pra fulano referente ao almoço*',
    '• *gastei 35 no mercado* · *uber 18,90*',
    '',
    'Também pode mandar *áudio* ou digitar *ajuda*.',
  ].join('\n');
}

export function replyAudioTranscriptionPreview(transcribedText: string): string {
  const clip =
    transcribedText.length > 280
      ? `${transcribedText.slice(0, 277).trim()}…`
      : transcribedText.trim();
  return [
    'Pelo áudio, entendi isto:',
    '',
    `_"${clip}"_`,
    '',
    'Se estiver certo, responda *sim* (ou *ok*) para eu registrar.',
    'Se não bateu, manda *outro áudio* ou escreva em texto.',
  ].join('\n');
}
