import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MessageDirection, MessageProvider, MessageType } from '../../shared/types/prisma-enums.js';
import { env } from '../../config/env.js';
import { waChatJidFromDigits } from '../../shared/utils/whatsapp-jid.js';
import type { AppWiring } from '../wiring.js';
import { TesseractOcrProvider } from '../../modules/media/infra/tesseract-ocr.provider.js';
import { WhisperCliTranscriptionProvider } from '../../modules/media/infra/whisper-cli.transcription.provider.js';
import { interpretBrazilianReceipt } from '../../modules/receipts/application/brazilian-receipt.interpreter.js';
import { receiptInterpretationToJson } from '../../modules/receipts/domain/receipt-interpretation.js';

const simulateTextBody = z.object({
  whatsappNumber: z.string().min(8),
  text: z.string().min(1),
  pushName: z.string().max(120).optional(),
});

export function registerDevRoutes(app: FastifyInstance, wiring: AppWiring): void {
  if (env.NODE_ENV === 'production') {
    return;
  }

  app.post('/dev/reprocess-message/:messageId', async (request, reply) => {
    const params = z.object({ messageId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.badRequest('messageId inválido');
    return reply.status(501).send({ error: 'Reprocessamento ainda não implementado neste MVP.' });
  });

  app.post('/dev/simulate-text', async (request, reply) => {
    const body = simulateTextBody.safeParse(request.body);
    if (!body.success) return reply.badRequest('Payload inválido');
    const digits = body.data.whatsappNumber.replace(/\D/g, '');
    await wiring.ingest.execute({
      provider: MessageProvider.WHATSAPP,
      providerMessageId: `dev-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
      direction: MessageDirection.INBOUND,
      messageType: MessageType.TEXT,
      waChatJid: waChatJidFromDigits(digits),
      pushName: body.data.pushName,
      rawText: body.data.text,
      receivedAt: new Date(),
    });
    return { ok: true };
  });

  app.post('/dev/simulate-ocr', async (request, reply) => {
    const body = z.object({ imagePath: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.badRequest('imagePath obrigatório');
    const ocr = new TesseractOcrProvider();
    const result = await ocr.extractText(body.data.imagePath);
    return result;
  });

  /** Pós-processamento de cupom/NF (texto já extraído por OCR ou colado). */
  app.post('/dev/interpret-receipt', async (request, reply) => {
    const body = z.object({ text: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.badRequest('text obrigatório');
    const r = interpretBrazilianReceipt(body.data.text);
    return receiptInterpretationToJson(r);
  });

  app.post('/dev/simulate-transcription', async (request, reply) => {
    const body = z.object({ audioPath: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.badRequest('audioPath obrigatório');
    const tr = new WhisperCliTranscriptionProvider();
    const result = await tr.transcribe(body.data.audioPath);
    return result;
  });

  const whatsappQuery = z.object({
    whatsappNumber: z.string().min(8),
  });

  app.get('/dev/reminders', async (request, reply) => {
    const q = whatsappQuery.safeParse(request.query);
    if (!q.success) return reply.badRequest('whatsappNumber obrigatório');
    const digits = q.data.whatsappNumber.replace(/\D/g, '');
    const user = await wiring.users.findByWhatsappNumber(digits);
    if (!user) return reply.notFound('Usuário não encontrado');
    const rows = await wiring.reminderRepository.listActiveForUser(user.id, { limit: 80 });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      eventAt: r.eventAt.toISOString(),
      notifyAt: r.notifyAt.toISOString(),
      allDay: r.allDay,
      recurrence: r.recurrence,
      timezone: r.timezone,
    }));
  });

  app.post('/dev/reminders/tick', async (_request, reply) => {
    const processed = await wiring.reminderScheduler.tickOnce();
    return reply.send({ ok: true, processed });
  });
}
