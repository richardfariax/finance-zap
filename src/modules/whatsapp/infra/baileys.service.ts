import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import { MessageProvider, MessageType } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { env } from '../../../config/env.js';
import type { NormalizedIngestMessage } from '../../../shared/domain/ingest-message.js';
import type { IngestInboundUseCase } from '../../messages/application/ingest-inbound.use-case.js';
import type { OutboundMessagesPort } from '../ports/outbound-messages.port.js';

function extractPhoneFromJid(jid: string): string {
  const user = jid.split('@')[0] ?? jid;
  return user.split(':')[0] ?? user;
}

function mapMessageType(mimetype: string | undefined, contentType: string | undefined): MessageType {
  if (contentType === 'imageMessage' || mimetype?.startsWith('image/')) return MessageType.IMAGE;
  if (contentType === 'audioMessage' || mimetype?.startsWith('audio/')) return MessageType.AUDIO;
  if (contentType === 'documentMessage') return MessageType.DOCUMENT;
  if (contentType === 'videoMessage') return MessageType.VIDEO;
  if (contentType === 'conversation' || contentType === 'extendedTextMessage') return MessageType.TEXT;
  return MessageType.OTHER;
}

export class BaileysOutboundAdapter implements OutboundMessagesPort {
  constructor(private readonly getSocket: () => WASocket | null) {}

  async sendText(whatsappNumberDigits: string, text: string): Promise<void> {
    const sock = this.getSocket();
    if (!sock) {
      throw new Error('WhatsApp socket not ready');
    }
    const jid = `${whatsappNumberDigits}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
  }
}

export class BaileysService {
  private sock: WASocket | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly ingest: IngestInboundUseCase,
    logger?: Logger,
  ) {
    this.logger = logger ?? pino({ level: env.LOG_LEVEL });
  }

  getOutbound(): OutboundMessagesPort {
    return new BaileysOutboundAdapter(() => this.sock);
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async sendText(whatsappNumberDigits: string, text: string): Promise<void> {
    await new BaileysOutboundAdapter(() => this.sock).sendText(whatsappNumberDigits, text);
  }

  async start(): Promise<void> {
    await mkdir(env.BAILEYS_AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(env.BAILEYS_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const silent = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger: silent,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silent),
      },
      printQRInTerminal: false,
    });

    this.sock = sock;

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.logger.info('Escaneie o QR Code no terminal para conectar o WhatsApp');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'close') {
        const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const shouldReconnect = err?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.warn({ shouldReconnect }, 'Conexão WhatsApp encerrada');
        if (shouldReconnect) {
          void this.start();
        }
      } else if (connection === 'open') {
        this.logger.info('WhatsApp conectado');
      }
    });

    sock.ev.on('messages.upsert', (upsert) => {
      void this.handleMessagesUpsert(sock, silent, upsert);
    });
  }

  private async handleMessagesUpsert(
    sock: WASocket,
    silent: Logger,
    upsert: { type: string; messages: WAMessage[] },
  ): Promise<void> {
      if (upsert.type !== 'notify') return;
      for (const msg of upsert.messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const remote = msg.key.remoteJid;
        if (!remote || remote.endsWith('@g.us')) continue;
        const userPart = extractPhoneFromJid(remote);
        const providerMessageId = msg.key.id ?? '';
        if (!providerMessageId) continue;

        const contentType = getContentType(msg.message);
        const textBody =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          msg.message.imageMessage?.caption ??
          msg.message.videoMessage?.caption ??
          msg.message.documentMessage?.caption ??
          null;

        const mime =
          msg.message.imageMessage?.mimetype ??
          msg.message.audioMessage?.mimetype ??
          msg.message.documentMessage?.mimetype ??
          msg.message.videoMessage?.mimetype ??
          undefined;

        const tsSec =
          typeof msg.messageTimestamp === 'number' && Number.isFinite(msg.messageTimestamp)
            ? msg.messageTimestamp
            : Math.floor(Date.now() / 1000);

        const normalized: NormalizedIngestMessage = {
          provider: MessageProvider.WHATSAPP,
          providerMessageId,
          direction: 'INBOUND',
          messageType: mapMessageType(mime, contentType),
          fromWhatsAppNumber: userPart,
          rawText: textBody,
          receivedAt: new Date(tsSec * 1000),
          mediaMimeType: mime,
        };

        const needsMedia =
          normalized.messageType === MessageType.IMAGE ||
          normalized.messageType === MessageType.AUDIO ||
          normalized.messageType === MessageType.DOCUMENT;

        try {
          if (needsMedia) {
            const ext =
              normalized.messageType === MessageType.AUDIO
                ? 'ogg'
                : normalized.messageType === MessageType.IMAGE
                  ? 'jpg'
                  : 'bin';
            await this.ingest.execute(normalized, {
              suggestedExtension: ext,
              download: async () => {
                try {
                  const buf = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                      logger: silent,
                      reuploadRequest: sock.updateMediaMessage,
                    },
                  );
                  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
                } catch (e) {
                  this.logger.error({ err: e }, 'Falha ao baixar mídia');
                  return null;
                }
              },
            });
          } else {
            await this.ingest.execute(normalized);
          }
        } catch (e) {
          this.logger.error({ err: e }, 'Erro ao processar mensagem');
        }
      }
  }
}
