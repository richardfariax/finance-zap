import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppWiring } from '../wiring.js';

const whatsappQuery = z.object({
  whatsappNumber: z.string().min(8).max(20),
});

const categoriesQuery = whatsappQuery.extend({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export function registerReportRoutes(app: FastifyInstance, wiring: AppWiring): void {
  app.get('/reports/monthly', async (request, reply) => {
    const q = whatsappQuery.safeParse(request.query);
    if (!q.success) return reply.badRequest('whatsappNumber obrigatório');
    const digits = q.data.whatsappNumber.replace(/\D/g, '');
    const user = await wiring.users.findByWhatsappNumber(digits);
    if (!user) return reply.notFound('Usuário não encontrado');
    const summary = await wiring.reports.monthlySummary(user.id, user.timezone);
    return {
      monthLabel: summary.monthLabel,
      income: summary.income.toString(),
      expense: summary.expense.toString(),
      balance: summary.balance.toString(),
    };
  });

  app.get('/reports/categories', async (request, reply) => {
    const q = categoriesQuery.safeParse(request.query);
    if (!q.success) return reply.badRequest('Parâmetros inválidos');
    const digits = q.data.whatsappNumber.replace(/\D/g, '');
    const user = await wiring.users.findByWhatsappNumber(digits);
    if (!user) return reply.notFound('Usuário não encontrado');
    const ref =
      q.data.year !== undefined && q.data.month !== undefined
        ? new Date(Date.UTC(q.data.year, q.data.month - 1, 15))
        : new Date();
    const rows = await wiring.reports.categoryBreakdown(user.id, user.timezone, ref);
    return rows.map((r) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      total: r.total.toString(),
    }));
  });

  app.get('/transactions/latest', async (request, reply) => {
    const q = whatsappQuery.safeParse(request.query);
    if (!q.success) return reply.badRequest('whatsappNumber obrigatório');
    const digits = q.data.whatsappNumber.replace(/\D/g, '');
    const user = await wiring.users.findByWhatsappNumber(digits);
    if (!user) return reply.notFound('Usuário não encontrado');
    const txs = await wiring.reports.latestTransactions(user.id, 20);
    return txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount.toString(),
      description: t.description,
      occurredAt: t.occurredAt,
      categoryId: t.categoryId,
    }));
  });
}
