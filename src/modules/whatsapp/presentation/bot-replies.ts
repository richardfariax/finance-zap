import { Decimal } from 'decimal.js';
import type { MonthlySummary, CategoryBreakdownRow } from '../../reports/application/reports.service.js';
import type { Transaction } from '@prisma/client';

const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(d: Decimal): string {
  return moneyFmt.format(Number(d.toFixed(2)));
}

export function replyExpenseRegistered(amount: Decimal, place: string, category: string): string {
  return `Despesa cadastrada: ${formatMoney(amount)} em ${place} na categoria ${category}.`;
}

export function replyIncomeRegistered(amount: Decimal, label: string): string {
  return `Receita cadastrada: ${formatMoney(amount)} em ${label}.`;
}

export function replyTransferRegistered(amount: Decimal, label: string): string {
  return `Transferência registrada: ${formatMoney(amount)} — ${label}.`;
}

export function replyMonthlySummary(s: MonthlySummary): string {
  return `Resumo de ${s.monthLabel}: receitas ${formatMoney(s.income)}, despesas ${formatMoney(s.expense)}, saldo ${formatMoney(s.balance)}.`;
}

export function replyCategoryBreakdown(rows: CategoryBreakdownRow[]): string {
  if (rows.length === 0) return 'Não há despesas categorizadas neste mês.';
  const top = rows.slice(0, 5);
  const parts = top.map((r) => `${r.categoryName} (${formatMoney(r.total)})`);
  return `Você gastou mais em: ${parts.join(', ')}.`;
}

export function replyTopExpenses(txs: Transaction[]): string {
  if (txs.length === 0) return 'Sem despesas no período.';
  const lines = txs.map(
    (t, i) => `${String(i + 1)}. ${t.description.slice(0, 40)} — ${formatMoney(new Decimal(t.amount.toString()))}`,
  );
  return `Maiores gastos:\n${lines.join('\n')}`;
}

export function replyLatestTransactions(txs: Transaction[]): string {
  if (txs.length === 0) return 'Nenhum lançamento ainda.';
  const lines = txs.map((t) => {
    return `• ${t.type} ${formatMoney(new Decimal(t.amount.toString()))} — ${t.description.slice(0, 36)}`;
  });
  return `Últimos lançamentos:\n${lines.join('\n')}`;
}

export function replyRecurring(list: { description: string; frequency: string; amount: string | null }[]): string {
  if (list.length === 0) return 'Ainda não detectei padrões recorrentes claros.';
  const lines = list.slice(0, 8).map((r) => `• ${r.description} (${r.frequency})${r.amount ? ` ~ ${r.amount}` : ''}`);
  return `Gastos com indício de recorrência:\n${lines.join('\n')}`;
}

export function replyHelp(): string {
  return [
    'Comandos úteis:',
    '• Lançar: "uber 23,50", "gastei 45 no mercado hoje", "recebi 2500 salário"',
    '• Relatórios: "quanto gastei esse mês?", "onde estou gastando mais?"',
    '• Último lançamento: "corrige o último lançamento para 59,90", "apaga o último lançamento"',
    '• Categoria: "muda a categoria do último para alimentação"',
    'Também envie foto de cupom ou áudio descrevendo a compra.',
  ].join('\n');
}
