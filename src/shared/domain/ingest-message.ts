import type { MessageType } from '@prisma/client';
import type { MessageProvider } from '@prisma/client';

export type IngestDirection = 'INBOUND' | 'OUTBOUND';

export interface NormalizedIngestMessage {
  provider: MessageProvider;
  providerMessageId: string;
  direction: IngestDirection;
  messageType: MessageType;
  fromWhatsAppNumber: string;
  rawText: string | null;
  receivedAt: Date;
  mediaDownloadKey?: string;
  mediaMimeType?: string;
}
