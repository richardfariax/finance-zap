import type { PendingConfirmation, Prisma } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export interface CreatePendingConfirmationInput {
  userId: string;
  messageId: string;
  contextType: string;
  payload: Prisma.InputJsonValue;
  expiresAt: Date;
}

export class PendingConfirmationRepository {
  async create(data: CreatePendingConfirmationInput): Promise<PendingConfirmation> {
    return prisma.pendingConfirmation.create({
      data: {
        userId: data.userId,
        messageId: data.messageId,
        contextType: data.contextType,
        payload: data.payload,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findLatestActive(userId: string, now: Date): Promise<PendingConfirmation | null> {
    return prisma.pendingConfirmation.findFirst({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteById(id: string): Promise<void> {
    await prisma.pendingConfirmation.delete({ where: { id } });
  }

  async deleteForUser(userId: string): Promise<void> {
    await prisma.pendingConfirmation.deleteMany({ where: { userId } });
  }
}
