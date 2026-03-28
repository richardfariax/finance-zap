import type { MessageType } from '@prisma/client';
import type { MessageProvider } from '@prisma/client';

export type IngestDirection = 'INBOUND' | 'OUTBOUND';

export interface NormalizedIngestMessage {
  provider: MessageProvider;
  providerMessageId: string;
  direction: IngestDirection;
  messageType: MessageType;
  /** JID completo para `sendMessage` (ex.: 5511999...@s.whatsapp.net ou ...@lid) */
  waChatJid: string;
  rawText: string | null;
  receivedAt: Date;
  mediaDownloadKey?: string;
  mediaMimeType?: string;
}
