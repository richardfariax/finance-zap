import type { MessageType, MessageProvider } from '../types/prisma-enums.js';

export type IngestDirection = 'INBOUND' | 'OUTBOUND';

export interface NormalizedIngestMessage {
  provider: MessageProvider;
  providerMessageId: string;
  direction: IngestDirection;
  messageType: MessageType;
  waChatJid: string;
  pushName?: string | null;
  rawText: string | null;
  receivedAt: Date;
  mediaDownloadKey?: string;
  mediaMimeType?: string;
}
