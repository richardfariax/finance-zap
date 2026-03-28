import {
  type ConfidenceLevel,
  type Message,
  type MessageDirection,
  type MessageProvider,
  type MessageType,
  type Prisma,
} from '@prisma/client';
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
}

export type { MessageDirection, MessageProvider, MessageType };
