import type { Message, Prisma } from '@prisma/client';
import {
  MessageDirection,
  type ConfidenceLevel,
  type MessageProvider,
  type MessageType,
} from '../../../shared/types/prisma-enums.js';
import { prisma } from '../../../shared/infra/prisma.js';

export class MessageRepository {
  async findByProviderId(
    userId: string,
    provider: MessageProvider,
    providerMessageId: string,
  ): Promise<Message | null> {
    return prisma.message.findUnique({
      where: {
        userId_provider_providerMessageId: { userId, provider, providerMessageId },
      },
    });
  }

  async create(data: Prisma.MessageCreateInput): Promise<Message> {
    return prisma.message.create({ data });
  }

  async updateMetadata(
    id: string,
    data: {
      processedText?: string | null;
      intent?: string | null;
      confidence?: ConfidenceLevel | null;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<Message> {
    return prisma.message.update({
      where: { id },
      data: {
        processedText: data.processedText,
        intent: data.intent,
        confidence: data.confidence,
        metadata: data.metadata,
      },
    });
  }

  async getById(id: string): Promise<Message | null> {
    return prisma.message.findUnique({ where: { id } });
  }

  async countInboundForUser(userId: string): Promise<number> {
    return prisma.message.count({
      where: {
        userId,
        direction: MessageDirection.INBOUND,
      },
    });
  }

  async listMediaPathsForUser(userId: string): Promise<string[]> {
    const rows = await prisma.message.findMany({
      where: {
        userId,
        mediaPath: { not: null },
      },
      select: { mediaPath: true },
    });
    return rows
      .map((r) => r.mediaPath)
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  }
}

export type { MessageProvider, MessageType };
export type { MessageDirection } from '../../../shared/types/prisma-enums.js';
