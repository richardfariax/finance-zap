import { Decimal } from 'decimal.js';
import type {
  DailySummary,
  MonthlySummary,
  CategoryBreakdownRow,
} from '../../reports/application/reports.service.js';
import type { Transaction } from '@prisma/client';
import type { TransactionType } from '../../../shared/types/prisma-enums.js';

const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(d: Decimal): string {
  return moneyFmt.format(Number(d.toFixed(2)));
}

function titleCasePt(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
}

export function replyParserNeedValueOnly(): string {
  return ['💰 *Valor não identificado*', '', 'Mande só o *valor* (ex.: *45,90* ou *120*).'].join(
    '\n',
  );
}

export function replyParserUnknownWithExamples(): string {
  return [
    '🤔 *Não consegui interpretar*',
    '',
    'Tente algo como:',
    '• *recebi 80 de fulano*',
    '• *paguei 45 no mercado*',
    '• *uber 23,50*',
    '',
    '🔗 Vários de uma vez: *uber 10, mercado 40*',
    '',
    '✏️ *Corrigir o último:* *corrige o último para 59,90* (numa linha ou *corrige o último, 59,90*)',
    '',
    '📘 Digite *ajuda* para ver tudo.',
  ].join('\n');
}

export function replyParserCorrectionNotLancamento(): string {
  return [
    '✏️ *Parece correção, não um lançamento novo*',
    '',
    'Para mudar o *valor* do último:',
    '• *corrige o último para 59,90*',
    '• ou *corrige para 59,90* (logo após registrar)',
    '',
    'Para *apagar* o último: *apaga o último lançamento*',
  ].join('\n');
}

export function replyMoneyOnlyNotLancamento(): string {
  return [
    '💡 *Só apareceu um valor*',
    '',
    'Para registrar, junte descrição e valor: *uber 23,50* ou *mercado 40*.',
    '',
    'Se era para *corrigir o último*, use: *corrige o último para 59,90*.',
  ].join('\n');
}

export function replyParserAskTransactionKind(): string {
  return [
    '❓ *Qual tipo de movimentação?*',
    '',
    'Foi *despesa*, *receita* ou *transferência*?',
    '',
    '_Responda com uma dessas palavras: despesa, receita ou transferência._',
  ].join('\n');
}

export function replyParserSuggestCategoryName(categoryName: string | null): string {
  const cat = categoryName ?? 'Outros';
  return [
    '🏷️ *Categoria sugerida*',
    '',
    `Usei *${cat}*.`,
    '',
    '✅ *sim* — confirma',
    '✏️ Outro *nome* — troca a categoria',
  ].join('\n');
}

export function replyCompoundBatchIntro(count: number): string {
  return [
    '🔗 *Vários lançamentos*',
    '',
    `Separei *${count}* registros (cada um após *vírgula* — valores tipo *23,50* contam como um valor só).`,
    '',
    'Processando em sequência…',
  ].join('\n');
}

export function replyCompoundStoppedForConfirmation(remaining: number): string {
  const r = remaining === 1 ? '1 lançamento' : `${String(remaining)} lançamentos`;
  return [
    '⏸️ *Aguardando confirmação*',
    '',
    `Faltam *${r}* depois deste.`,
    '',
    'Responda à mensagem anterior (*sim*, nome da categoria…).',
    'Depois mande de novo o que faltou, se quiser.',
  ].join('\n');
}

export function replyAskReportScope(): string {
  return [
    '📊 *Resumo*',
    '',
    'Você quer ver:',
    '',
    '📅 *Hoje* — movimentação do dia',
    '🗓️ *Mês* — levantamento do mês atual',
    '',
    '_Responda *hoje* ou *mês*._',
  ].join('\n');
}

export function replyReportScopeUnclear(): string {
  return ['👆 Só preciso de uma opção:', '', '• *hoje* — dia', '• *mês* — mês atual'].join('\n');
}

export function replyExpenseRegistered(amount: Decimal, place: string, category: string): string {
  return [
    `✅ ${formatMoney(amount)} · ${place}`,
    `🏷️ ${category}`,
    '_Categoria errada? É só avisar._',
  ].join('\n');
}

export function replyIncomeRegistered(amount: Decimal, label: string): string {
  return ['✅ *Receita anotada*', '', formatMoney(amount), `📥 ${label}`].join('\n');
}

export function replyTransferRegistered(amount: Decimal, label: string): string {
  return ['✅ *Transferência anotada*', '', formatMoney(amount), `↔️ ${label}`].join('\n');
}

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
    comparativo = 'Mesmo patamar de despesas que o mês anterior.';
  } else if (deltaExp.gt(0)) {
    comparativo = `📈 *${formatMoney(deltaExp.abs())}* a mais que no mês anterior.`;
  } else {
    comparativo = `📉 *${formatMoney(deltaExp.abs())}* a menos que no mês anterior.`;
  }

  const lines: string[] = [
    '🗓️ *Mês*',
    `_${current.monthLabel}_`,
    '',
    '💵 *Totais*',
    `➕ Receitas · *${formatMoney(current.income)}*`,
    `➖ Despesas · *${formatMoney(current.expense)}*`,
    `⚖️ Saldo · *${formatMoney(current.balance)}*`,
    '',
    '📊 *Comparativo*',
    `Mês anterior (despesas): ${formatMoney(previous.expense)}`,
    comparativo,
  ];

  if (breakdown.length > 0) {
    lines.push('', '📂 *Por categoria*');
    breakdown.slice(0, 10).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} · *${formatMoney(r.total)}*`);
    });
  } else {
    lines.push('', '_Sem despesas categorizadas neste mês._');
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
      '📅 *Hoje*',
      `_${wd}, ${day.dayLabel}_`,
      '',
      '_Nada registrado ainda hoje._',
      '',
      'Quando você anotar gastos ou entradas, o resumo aparece aqui.',
    ].join('\n');
  }

  const lines: string[] = [
    '📅 *Hoje*',
    `_${wd}, ${day.dayLabel}_`,
    '',
    '💵 *Resumo*',
    `➕ Receitas · *${formatMoney(day.income)}*`,
    `➖ Despesas · *${formatMoney(day.expense)}*`,
    `⚖️ Saldo · *${formatMoney(day.balance)}*`,
  ];

  if (breakdown.length > 0) {
    lines.push('', '📂 *Despesas por categoria*');
    breakdown.slice(0, 10).forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} · *${formatMoney(r.total)}*`);
    });
  }

  if (top.length > 0) {
    lines.push('', '🔝 *Maiores despesas*');
    top.forEach((t, i) => {
      const amt = new Decimal(t.amount.toString());
      lines.push(`${String(i + 1)}. ${t.description.slice(0, 38)} · *${formatMoney(amt)}*`);
    });
  }

  return lines.join('\n');
}

export function replyCategoryBreakdown(rows: CategoryBreakdownRow[]): string {
  if (rows.length === 0) {
    return ['📂 *Por categoria*', '', '_Nenhuma despesa categorizada no mês._'].join('\n');
  }
  const top = rows.slice(0, 5);
  const lines = [
    '📂 *Onde mais saiu*',
    '',
    ...top.map((r, i) => `${String(i + 1)}. ${r.categoryName} · *${formatMoney(r.total)}*`),
  ];
  return lines.join('\n');
}

export function replyTopExpenses(txs: Transaction[]): string {
  if (txs.length === 0) {
    return ['🔝 *Maiores gastos*', '', '_Nada no período._'].join('\n');
  }
  const lines = [
    '🔝 *Maiores gastos*',
    '',
    ...txs.map(
      (t, i) =>
        `${String(i + 1)}. ${t.description.slice(0, 40)} · *${formatMoney(new Decimal(t.amount.toString()))}*`,
    ),
  ];
  return lines.join('\n');
}

export function replyLatestTransactions(txs: Transaction[]): string {
  if (txs.length === 0) {
    return ['📋 *Últimos lançamentos*', '', '_Ainda vazio._'].join('\n');
  }
  const lines = [
    '📋 *Últimos lançamentos*',
    '',
    ...txs.map((t) => {
      const icon = t.type === 'INCOME' ? '➕' : t.type === 'EXPENSE' ? '➖' : '↔️';
      return `${icon} ${formatMoney(new Decimal(t.amount.toString()))} · ${t.description.slice(0, 36)}`;
    }),
  ];
  return lines.join('\n');
}

export function replyRecurring(
  list: { description: string; frequency: string; amount: string | null }[],
): string {
  if (list.length === 0) {
    return ['🔁 *Recorrentes*', '', '_Nenhum padrão forte detectado ainda._'].join('\n');
  }
  const lines = [
    '🔁 *Parecem recorrentes*',
    '',
    ...list
      .slice(0, 8)
      .map((r) => `• ${r.description} (${r.frequency})${r.amount ? ` ~ ${r.amount}` : ''}`),
  ];
  return lines.join('\n');
}

export function replyIntro(): string {
  return [
    '👋 *Finance Zap* — finanças sem planilha ✨',
    '',
    '✏️ *uber 23,50* · *gastei 40 no mercado* · *recebi 50 de fulano*',
    '🔗 *uber 10, padaria 15*',
    '',
    '📊 *resumo* · 📘 *ajuda*',
  ].join('\n');
}

export function replyWelcome(): string {
  return replyIntro();
}

export function replyHelp(): string {
  return [
    '📘 *Ajuda — Finance Zap*',
    '',
    'Fale em português, do seu jeito.',
    '',
    '➖ *Despesa*',
    '• uber 23,50',
    '• gastei 45 no mercado',
    '• vários na mesma mensagem: *uber 10, mercado 40*',
    '',
    '➕ *Receita*',
    '• recebi 2500 de salário',
    '• recebi 80 de fulano',
    '',
    '📊 *Consultas*',
    '• *resumo* → pergunto dia ou mês',
    '• *quanto gastei hoje?*',
    '• *quanto gastei esse mês?*',
    '• *onde estou gastando mais?*',
    '• *últimos lançamentos*',
    '',
    '✏️ *Último lançamento*',
    '• apaga o último lançamento',
    '• corrige o último para 59,90 (ou *corrige para 59,90* em seguida)',
    '• *corrige o último, 59,90* — vírgula não vira lançamento novo',
    '• muda a categoria do último para alimentação',
    '',
    '🗑️ *Apagar tudo (recomeçar)*',
    '• *apagar todos os dados* ou *apagar tudo*',
    '• *apagar meus dados*, *resetar minha conta*, *limpar minha conta*',
    'Apaga lançamentos, suas categorias, regras e histórico. Na *próxima* mensagem mando a saudação de novo.',
    '_Não dá para desfazer._',
    '',
    '🎤 *Áudio / foto*',
    'Áudio: transcrevo e peço *sim* antes de salvar.',
    '',
    '💬 Dúvida? Reformule ou diga *ajuda*.',
  ].join('\n');
}

export function replyAccountDataWiped(): string {
  return [
    '🗑️ *Seus dados foram apagados*',
    '',
    'Removi lançamentos, categorias suas, regras, recorrências, histórico de mensagens e pendências.',
    'Na *próxima mensagem* você recebe a saudação como se fosse a primeira vez.',
    '',
    '_Isso não pode ser desfeito._',
  ].join('\n');
}

export function extendLowConfidenceClarification(clarification: string): string {
  return [
    clarification.trim(),
    '',
    '💡 *quais categorias* — lista',
    '🚫 *cancelar* — não salvar',
    '',
    '🔗 Outros lançamentos na mesma mensagem: use *vírgula* entre eles.',
  ].join('\n');
}

export function replyPendingLowConfidenceReminder(): string {
  return [
    '⏳ *Lançamento pendente*',
    '',
    '✅ *sim* — confirma a categoria',
    '✏️ *nome* — outra categoria',
    '',
    '💡 *quais categorias* · 🚫 *cancelar*',
  ].join('\n');
}

function categoryListIntroForType(transactionType: TransactionType): string {
  if (transactionType === 'EXPENSE') return '📂 *Despesa — categorias*';
  if (transactionType === 'INCOME') return '📂 *Receita — categorias*';
  return '📂 *Transferência — categorias*';
}

export function replyCategoryOptionsWhilePending(
  categoryNames: string[],
  transactionType: TransactionType | null,
): string {
  const lines = categoryNames.map((name) => `• ${name}`);
  const intro = transactionType
    ? categoryListIntroForType(transactionType)
    : '📂 *Categorias disponíveis*';
  return [intro, '', ...lines, '', '✅ *sim* confirma · ✏️ *nome* troca'].join('\n');
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
    '💬 *muda a categoria do último para (nome)*',
  ].join('\n');
}

export function replySoftUnknown(): string {
  return [
    '🤔 *Não entendi*',
    '',
    'Exemplos:',
    '• recebi 50 de fulano',
    '• paguei 120 no almoço',
    '• uber 18,90',
    '• uber 10, padaria 20',
    '',
    '🎤 Áudio · 📘 *ajuda*',
  ].join('\n');
}

export function replyAudioTranscriptionPreview(transcribedText: string): string {
  const clip =
    transcribedText.length > 280
      ? `${transcribedText.slice(0, 277).trim()}…`
      : transcribedText.trim();
  return [
    '🎤 *Transcrição*',
    '',
    `_"${clip}"_`,
    '',
    '✅ *sim* ou *ok* — registrar',
    '🔁 Outro áudio ou texto — corrigir',
    '',
    '🔗 Vários de uma vez: separe com *vírgula* (ex.: *uber 10, mercado 20*).',
  ].join('\n');
}

export function replyTranscriptionEmpty(): string {
  return [
    '🎤 *Transcrição vazia*',
    '',
    'Confira *Whisper* e *ffmpeg* no `.env`.',
    'Ou mande em *texto*.',
  ].join('\n');
}

export function replyNoTextInMessage(): string {
  return ['📝 *Sem texto*', '', 'Mande em texto, áudio ou foto com valor legível.'].join('\n');
}

export function replyClarifyTransactionTypeAgain(): string {
  return ['❓ *Só falta o tipo*', '', '*despesa*, *receita* ou *transferência*?'].join('\n');
}

export function replyCancelLowConfidence(): string {
  return [
    '🚫 *Descartado*',
    '',
    'Não salvei esse lançamento.',
    'Quando quiser, manda de novo.',
  ].join('\n');
}

export function replyInvalidPendingContext(): string {
  return ['⚠️ Algo deu errado no contexto.', '', 'Tente o lançamento de novo.'].join('\n');
}

export function replyLastTxNotFound(): string {
  return ['📭 *Nada recente*', '', 'Não achei lançamento para ajustar.'].join('\n');
}

export function replyLastTxDeleteFail(): string {
  return ['⚠️ Não consegui apagar.', '', 'Tente de novo em instantes.'].join('\n');
}

export function replyLastTxDeleted(): string {
  return ['🗑️ *Apagado*', '', 'Último lançamento removido.'].join('\n');
}

export function replyLastTxAmountFail(): string {
  return ['⚠️ Não consegui atualizar o valor.'].join('\n');
}

export function replyLastTxAmountNeedsValue(): string {
  return [
    '✏️ *Falta o valor*',
    '',
    'Ex.: *corrige o último para 59,90* ou *corrige o último, 59,90*',
  ].join('\n');
}

export function replyLastTxAmountUpdated(amount: Decimal): string {
  const br = amount.toFixed(2).replace('.', ',');
  return ['✅ *Valor atualizado*', '', `*${br}* BRL`].join('\n');
}

export function replyLastTxCategoryNotFound(): string {
  return [
    '🏷️ *Categoria não encontrada*',
    '',
    'Use um nome parecido com as categorias padrão.',
    '💡 *quais categorias* — ver lista',
  ].join('\n');
}

export function replyLastTxCategoryUpdateFail(): string {
  return ['⚠️ Não consegui mudar a categoria.'].join('\n');
}

export function replyLastTxCategoryUpdated(categoryName: string): string {
  return ['✅ *Categoria atualizada*', '', `*${categoryName}*`].join('\n');
}

export function firstNameFromPush(pushName: string | null | undefined): string {
  const t = (pushName ?? '').trim();
  if (!t) return 'amigo';
  const w = (t.split(/\s+/)[0] ?? t).trim();
  const clean = w.replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return 'amigo';
  return titleCasePt(clean.toLowerCase());
}

export function replyOnboardingWelcome(displayName: string): string {
  return [
    `Olá, *${displayName}*! 👋✨`,
    '',
    'Sou o *Finance Zap* — anoto seus gastos e receitas aqui.',
    '',
    '💝 Tudo *grátis*.',
    '',
    '_Manda um lançamento quando quiser._ 📲',
  ].join('\n');
}

export function replyAutomatedDaySummary(
  day: DailySummary,
  topCategories: CategoryBreakdownRow[],
  didacticLine: string,
): string {
  const wd = titleCasePt(day.weekdayLabel);
  if (day.income.isZero() && day.expense.isZero()) {
    return [`🌙 *Ontem* (${wd}) — sem registros.`, '', `💡 ${didacticLine}`].join('\n');
  }
  const lines: string[] = [
    `🌙 *Resumo de ontem* · ${wd}`,
    '',
    `💸 Despesas *${formatMoney(day.expense)}*`,
    `💵 Receitas *${formatMoney(day.income)}*`,
    `⚖️ Saldo *${formatMoney(day.balance)}*`,
  ];
  const top = topCategories.filter((r) => r.total.gt(0)).slice(0, 3);
  if (top.length > 0) {
    lines.push('', '📂 *Onde mais saiu*');
    top.forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r.categoryName} · ${formatMoney(r.total)}`);
    });
  }
  lines.push('', `💡 ${didacticLine}`);
  return lines.join('\n');
}

export function replyPinConversationNudge(): string {
  return [
    '👋 *Oi! Faz um tempinho sem mensagens por aqui.*',
    '',
    '📌 *Fixe este chat* no WhatsApp — fica fácil de achar e você não perde o resumo da madrugada 🌙',
    '',
    '📱 *Android:* ⋮ no topo → *Fixar conversa*',
    '🍎 *iPhone:* deslize o chat → *Fixar*',
    '',
    '_Um “uber 15” ou áudio já atualiza tudo._ ✨',
  ].join('\n');
}

export const DIDACTIC_TIPS_POOL = [
  'Vários gastos numa vez: *uber 10, mercado 40* (vírgula entre eles).',
  'Dúvida? Manda *ajuda*.',
  'Errou o valor? *corrige o último para 50*',
  'Visão do mês: diga *resumo*.',
  'Áudio também vale — eu transcrevo e peço *sim* pra salvar.',
] as const;

export function pickDidacticTip(seed: number): string {
  const pool = DIDACTIC_TIPS_POOL;
  const i = Math.abs(seed) % pool.length;
  return pool[i] ?? pool[0];
}
