import type { User } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export class UserRepository {
  async findByWhatsappNumber(whatsappNumber: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { whatsappNumber } });
  }

  async create(data: {
    whatsappNumber: string;
    displayName?: string | null;
    timezone?: string;
    locale?: string;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        whatsappNumber: data.whatsappNumber,
        displayName: data.displayName ?? null,
        timezone: data.timezone ?? 'America/Sao_Paulo',
        locale: data.locale ?? 'pt-BR',
      },
    });
  }

  async getById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async mergeChatProfile(
    userId: string,
    patch: {
      displayName?: string | null;
      waChatJid?: string | null;
    },
  ): Promise<User> {
    const data: Record<string, unknown> = {};
    if (
      patch.waChatJid !== undefined &&
      patch.waChatJid !== null &&
      patch.waChatJid.trim() !== ''
    ) {
      data.waChatJid = patch.waChatJid.trim();
    }
    if (
      patch.displayName !== undefined &&
      patch.displayName !== null &&
      patch.displayName.trim() !== ''
    ) {
      data.displayName = patch.displayName.trim();
    }
    if (Object.keys(data).length === 0) {
      return prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async recordInboundActivity(userId: string, waChatJid: string, at: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        waChatJid: waChatJid.trim(),
        lastInboundAt: at,
      },
    });
  }

  async markOnboardingWelcomeSent(userId: string, at: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { onboardingWelcomeSentAt: at },
    });
  }

  async setLastDailySummaryForDate(userId: string, dateKey: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastDailySummaryForDate: dateKey },
    });
  }

  async setLastPinNudgeAt(userId: string, at: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastPinNudgeAt: at },
    });
  }

  async listForProactiveOutreach(): Promise<User[]> {
    return prisma.user.findMany({
      where: {
        waChatJid: { not: null },
        lastInboundAt: { not: null },
      },
    });
  }

  async wipeClientData(userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.pendingConfirmation.deleteMany({ where: { userId } });
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.rule.deleteMany({ where: { userId } });
      await tx.recurringPattern.deleteMany({ where: { userId } });
      await tx.message.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });
      await tx.auditLog.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          onboardingWelcomeSentAt: null,
          lastDailySummaryForDate: null,
          lastPinNudgeAt: null,
          lastInboundAt: null,
        },
      });
    });
  }
}
