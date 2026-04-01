import {
  Prisma,
  type Prisma as PrismaNs,
  type ReminderRecurrence,
  type ReminderSource,
  type ReminderStatus,
  type UserReminder,
} from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export type CreateReminderInput = {
  userId: string;
  title: string;
  notes?: string | null;
  eventAt: Date;
  allDay: boolean;
  notifyAt: Date;
  earlyMinutes: number;
  recurrence: ReminderRecurrence;
  recurrenceMeta?: PrismaNs.InputJsonValue | null;
  timezone: string;
  sourceText?: string | null;
  source?: ReminderSource;
  sourceMessageId?: string | null;
};

export class ReminderRepository {
  async create(data: CreateReminderInput): Promise<UserReminder> {
    return prisma.userReminder.create({
      data: {
        userId: data.userId,
        title: data.title.slice(0, 500),
        notes: data.notes ?? null,
        eventAt: data.eventAt,
        allDay: data.allDay,
        notifyAt: data.notifyAt,
        earlyMinutes: data.earlyMinutes,
        recurrence: data.recurrence,
        recurrenceMeta: data.recurrenceMeta ?? undefined,
        timezone: data.timezone,
        sourceText: data.sourceText ?? null,
        source: data.source ?? 'TEXT',
        sourceMessageId: data.sourceMessageId ?? null,
        status: 'ACTIVE',
      },
    });
  }

  async findByIdForUser(id: string, userId: string): Promise<UserReminder | null> {
    return prisma.userReminder.findFirst({
      where: { id, userId },
    });
  }

  /** Lembretes ativos cuja notificação já deveria ter sido enviada (com tolerância a atraso). */
  async findDue(beforeUtc: Date, afterUtc: Date, take = 80): Promise<UserReminder[]> {
    return prisma.userReminder.findMany({
      where: {
        status: 'ACTIVE',
        notifyAt: { lte: beforeUtc, gte: afterUtc },
      },
      orderBy: { notifyAt: 'asc' },
      take,
    });
  }

  async listActiveForUser(
    userId: string,
    opts: { fromUtc?: Date; untilUtc?: Date; limit?: number } = {},
  ): Promise<UserReminder[]> {
    const { fromUtc, untilUtc, limit = 30 } = opts;
    return prisma.userReminder.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        ...(fromUtc || untilUtc
          ? {
              eventAt: {
                ...(fromUtc ? { gte: fromUtc } : {}),
                ...(untilUtc ? { lte: untilUtc } : {}),
              },
            }
          : {}),
      },
      orderBy: { eventAt: 'asc' },
      take: limit,
    });
  }

  async searchActiveByTitle(userId: string, hint: string): Promise<UserReminder[]> {
    const h = hint.trim().toLowerCase();
    if (h.length < 2) return [];
    const all = await prisma.userReminder.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    return all.filter((r) => r.title.toLowerCase().includes(h));
  }

  async cancel(id: string, userId: string): Promise<boolean> {
    const r = await prisma.userReminder.updateMany({
      where: { id, userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', canceledAt: new Date() },
    });
    return r.count > 0;
  }

  async complete(id: string, userId: string): Promise<boolean> {
    const r = await prisma.userReminder.updateMany({
      where: { id, userId, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return r.count > 0;
  }

  async updateSchedule(
    id: string,
    userId: string,
    patch: { eventAt: Date; notifyAt: Date; allDay?: boolean },
  ): Promise<boolean> {
    const r = await prisma.userReminder.updateMany({
      where: { id, userId, status: 'ACTIVE' },
      data: {
        eventAt: patch.eventAt,
        notifyAt: patch.notifyAt,
        ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
      },
    });
    return r.count > 0;
  }

  async updateAfterDelivery(
    id: string,
    patch: {
      status?: ReminderStatus;
      eventAt?: Date;
      notifyAt?: Date;
      completedAt?: Date | null;
    },
  ): Promise<void> {
    await prisma.userReminder.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.eventAt ? { eventAt: patch.eventAt } : {}),
        ...(patch.notifyAt ? { notifyAt: patch.notifyAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      },
    });
  }

  /**
   * Registro idempotente de disparo. Retorna true se esta instância pode enviar a mensagem.
   */
  async tryClaimDeliverySlot(reminderId: string, slotAt: Date): Promise<boolean> {
    try {
      await prisma.reminderDelivery.create({
        data: { reminderId, slotAt },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await prisma.userReminder.deleteMany({ where: { userId } });
  }
}
