import {
  ConfidenceLevel,
  type Category,
  MessageDirection,
  MessageProvider,
  MessageType,
  TransactionType,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { addHours } from 'date-fns';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import type { NormalizedIngestMessage } from '../../../shared/domain/ingest-message.js';
import { accountKeyFromWaChatJid } from '../../../shared/utils/whatsapp-jid.js';
import { UserIntent, ParseStatus, type UserIntentType } from '../../../shared/types/intent.js';
import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import { normalizeVoiceNoteText } from '../../../shared/utils/voice-transcript-normalize.js';
import type { AuditService } from '../../audit/application/audit.service.js';
import type { CategoryRepository } from '../../categories/infra/category.repository.js';
import { PendingContextType } from '../../confirmations/domain/pending-context.js';
import { AudioTranscriptPayloadSchema } from '../../confirmations/dto/audio-transcript.payload.js';
import { TransactionDraftPayloadSchema } from '../../confirmations/dto/transaction-draft.payload.js';
import type { PendingConfirmationRepository } from '../../confirmations/infra/pending-confirmation.repository.js';
import { MediaStorageService } from '../../media/application/media-storage.service.js';
import { TesseractOcrProvider } from '../../media/infra/tesseract-ocr.provider.js';
import { WhisperCliTranscriptionProvider } from '../../media/infra/whisper-cli.transcription.provider.js';
import { FinancialParserService } from '../../parser/application/financial-parser.service.js';
import type { ParseResult } from '../../parser/domain/parse-result.js';
import type { RecurrenceDetectorService } from '../../recurrence/application/recurrence-detector.service.js';
import type { ReportsService } from '../../reports/application/reports.service.js';
import type { RuleRepository } from '../../rules/infra/rule.repository.js';
import type { CreateTransactionUseCase } from '../../transactions/application/create-transaction.use-case.js';
import { parseLastTransactionCommand } from '../../transactions/application/last-transaction-commands.js';
import type { TransactionRepository } from '../../transactions/infra/transaction.repository.js';
import type { TransactionDraftPayload } from '../../confirmations/dto/transaction-draft.payload.js';
import type { OutboundMessagesPort } from '../../whatsapp/ports/outbound-messages.port.js';
import {
  replyAudioTranscriptionPreview,
  replyCategoryBreakdown,
  replyCategoryOptionsForLastTransaction,
  replyCategoryOptionsWhilePending,
  extendLowConfidenceClarification,
  replyExpenseRegistered,
  replyHelp,
  replyIncomeRegistered,
  replyIntro,
  replyLatestTransactions,
  replyMonthLedger,
  replyPendingLowConfidenceReminder,
  replyRecurring,
  replySoftUnknown,
  replyTodayLedger,
  replyTopExpenses,
  replyTransferRegistered,
} from '../../whatsapp/presentation/bot-replies.js';
import type { EnsureUserUseCase } from '../../users/application/ensure-user.use-case.js';
import type { MessageRepository } from '../infra/message.repository.js';
import {
  isAffirmative,
  isExplicitCancellation,
  pickCategoryIdForLowConfidenceConfirm,
} from './low-confidence-pending.js';

function parseTypeClarification(text: string): TransactionType | null {
  const n = normalizeForMatch(text);
  if (/\b(despesa|gasto|debito|débito)\b/.test(n)) return TransactionType.EXPENSE;
  if (/\b(receita|entrada|credito|crédito)\b/.test(n)) return TransactionType.INCOME;
  if (/\b(transferencia|transferência|pix envio)\b/.test(n)) return TransactionType.TRANSFER;
  return null;
}

function isSameAmountCreateParsed(
  parsed: ParseResult,
  draft: TransactionDraftPayload,
): boolean {
  const type = draft.transactionType;
  if (!type || !parsed.amount) return false;
  const expectedIntent =
    type === TransactionType.EXPENSE
      ? UserIntent.CREATE_EXPENSE
      : type === TransactionType.INCOME
        ? UserIntent.CREATE_INCOME
        : UserIntent.CREATE_TRANSFER;
  if (parsed.intent !== expectedIntent) return false;
  return new Decimal(draft.amount).equals(parsed.amount);
}

function isQueryIntentThatAbandonsPending(intent: UserIntentType): boolean {
  switch (intent) {
    case UserIntent.HELP:
    case UserIntent.GREETING:
    case UserIntent.GET_TODAY_SUMMARY:
    case UserIntent.GET_MONTH_SUMMARY:
    case UserIntent.GET_CATEGORY_BREAKDOWN:
    case UserIntent.GET_TOP_EXPENSES:
    case UserIntent.GET_LAST_TRANSACTIONS:
    case UserIntent.GET_RECURRING_EXPENSES:
      return true;
    default:
      return false;
  }
}

/** Pergunta tipo "quais categorias tem?" durante confirmação de categoria. */
function isListCategoriesQuery(text: string): boolean {
  const n = normalizeForMatch(text);
  if (!/\bcategorias?\b/.test(n)) return false;
  if (/\b(quais|que)\s+categorias?\b/.test(n)) return true;
  if (/\bcategorias?\s+(tem|existem|disponiveis|disponíveis|cadastrad)\b/.test(n)) return true;
  if (/\b(lista|listar|mostrar|ver)\s+(de\s+)?as?\s*categorias?\b/.test(n)) return true;
  if (/\b(tem\s+quais|quais\s+tem)\s+categorias?\b/.test(n)) return true;
  if (/\bnomes?\s+(das?\s+)?categorias?\b/.test(n)) return true;
  return false;
}

function categoriesApplicableToTransaction(cats: Category[], type: TransactionType): Category[] {
  if (type === TransactionType.EXPENSE) {
    return cats.filter((c) => c.kind === 'EXPENSE' || c.kind === 'BOTH');
  }
  if (type === TransactionType.INCOME) {
    return cats.filter((c) => c.kind === 'INCOME' || c.kind === 'BOTH');
  }
  return cats.filter((c) => c.kind === 'BOTH');
}

export class IngestInboundUseCase {
  private readonly parser = new FinancialParserService();
  private readonly ocr = new TesseractOcrProvider();
  private readonly transcription = new WhisperCliTranscriptionProvider();
  private readonly mediaStorage = new MediaStorageService();

  constructor(
    private readonly ensureUser: EnsureUserUseCase,
    private readonly messages: MessageRepository,
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
    private readonly rules: RuleRepository,
    private readonly pending: PendingConfirmationRepository,
    private readonly createTx: CreateTransactionUseCase,
    private readonly reports: ReportsService,
    private readonly recurrence: RecurrenceDetectorService,
    private readonly audit: AuditService,
    private readonly outbound: OutboundMessagesPort,
    private readonly log?: Logger,
  ) {}

  async execute(
    event: NormalizedIngestMessage,
    media?: { download: () => Promise<Buffer | null>; suggestedExtension: string },
  ): Promise<void> {
    const accountKey = accountKeyFromWaChatJid(event.waChatJid);
    const replyJid = event.waChatJid;
    const user = await this.ensureUser.execute({
      whatsappNumber: accountKey,
      timezone: env.DEFAULT_TIMEZONE,
      locale: env.DEFAULT_LOCALE,
    });

    const existing = await this.messages.findByProviderId(
      user.id,
      MessageProvider.WHATSAPP,
      event.providerMessageId,
    );
    if (existing) return;

    const rawText = event.rawText;
    let processedText = rawText;
    let mediaPath: string | null = null;
    let sourceConfidence: ConfidenceLevel | undefined;

    const msg = await this.messages.create({
      user: { connect: { id: user.id } },
      provider: MessageProvider.WHATSAPP,
      providerMessageId: event.providerMessageId,
      direction: MessageDirection.INBOUND,
      messageType: event.messageType,
      rawText: rawText ?? null,
      processedText: null,
      mediaPath: null,
      mediaMimeType: event.mediaMimeType ?? null,
      intent: null,
      confidence: null,
      metadata: {},
      receivedAt: event.receivedAt,
    });

    if (
      media &&
      (event.messageType === MessageType.IMAGE || event.messageType === MessageType.DOCUMENT)
    ) {
      const buf = await media.download();
      if (buf) {
        mediaPath = await this.mediaStorage.saveBuffer({
          userId: user.id,
          extension: media.suggestedExtension,
          buffer: buf,
        });
        try {
          const ocr = await this.ocr.extractText(mediaPath);
          processedText = ocr.text;
          sourceConfidence = ocr.confidence;
        } catch {
          processedText = rawText ?? '';
          sourceConfidence = ConfidenceLevel.LOW;
        }
      }
    } else if (media && event.messageType === MessageType.AUDIO) {
      const buf = await media.download();
      if (buf) {
        mediaPath = await this.mediaStorage.saveBuffer({
          userId: user.id,
          extension: media.suggestedExtension,
          buffer: buf,
        });
        const tr = await this.transcription.transcribe(mediaPath, event.mediaMimeType ?? undefined);
        const rawTranscript = (tr.text || rawText || '').trim();
        processedText = normalizeVoiceNoteText(rawTranscript) || rawTranscript;
        sourceConfidence = tr.confidence;
        if (!tr.text.trim()) {
          await this.safeSend(
            replyJid,
            'Não rolou transcrever esse áudio. Confere whisper/ffmpeg no projeto ou manda o mesmo recado em texto.',
          );
        }
      }
    }

    await this.messages.updateMetadata(msg.id, {
      processedText,
      metadata: {
        mediaPath,
        sourceConfidence,
      },
    });

    const textForPipeline = (processedText ?? '').replace(/\s+/g, ' ').trim();
    if (!textForPipeline) {
      await this.safeSend(
        replyJid,
        'Não achei texto aqui. Manda de novo em texto, áudio ou uma foto com o valor legível.',
      );
      return;
    }

    if (event.messageType === MessageType.AUDIO) {
      await this.pending.deleteForUser(user.id);
      await this.pending.create({
        userId: user.id,
        messageId: msg.id,
        contextType: PendingContextType.CONFIRM_AUDIO_TRANSCRIPT,
        payload: {
          transcribedText: textForPipeline,
          audioMessageId: msg.id,
          userTimezone: user.timezone,
        },
        expiresAt: addHours(new Date(), 24),
      });
      await this.safeSend(replyJid, replyAudioTranscriptionPreview(textForPipeline));
      return;
    }

    const pendingHandled = await this.tryHandlePending(
      user.id,
      msg.id,
      replyJid,
      textForPipeline,
      user.timezone,
    );
    if (pendingHandled) return;

    const cmd = parseLastTransactionCommand(textForPipeline);
    if (cmd.kind !== 'NONE') {
      await this.handleLastCommand(user.id, replyJid, cmd);
      return;
    }

    const rules = await this.rules.listActiveForUser(user.id);
    const cats = await this.categories.listForUser(user.id);
    const parsed = this.parser.parse({
      text: textForPipeline,
      now: new Date(),
      userTimezone: user.timezone,
      rules,
      categories: cats,
      sourceConfidence,
    });

    await this.messages.updateMetadata(msg.id, {
      intent: parsed.intent,
      confidence: parsed.confidence,
    });

    await this.dispatchParsed(user.id, msg.id, replyJid, parsed, user.timezone, {
      inboundText: textForPipeline,
    });
  }

  private async runPipelineAfterAudioConfirm(
    userId: string,
    confirmMessageId: string,
    replyJid: string,
    transcribedText: string,
    userTimezone: string,
    audioMessageId: string,
  ): Promise<void> {
    const audioMsg = await this.messages.getById(audioMessageId);
    let sourceConfidence: ConfidenceLevel | undefined;
    if (audioMsg?.metadata && typeof audioMsg.metadata === 'object') {
      const v = (audioMsg.metadata as Record<string, unknown>).sourceConfidence;
      if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH') {
        sourceConfidence = v as ConfidenceLevel;
      }
    }

    const rules = await this.rules.listActiveForUser(userId);
    const cats = await this.categories.listForUser(userId);
    const parsed = this.parser.parse({
      text: transcribedText,
      now: new Date(),
      userTimezone,
      rules,
      categories: cats,
      sourceConfidence,
    });

    await this.messages.updateMetadata(confirmMessageId, {
      intent: parsed.intent,
      confidence: parsed.confidence,
    });

    await this.dispatchParsed(userId, confirmMessageId, replyJid, parsed, userTimezone, {
      transactionSourceMessageId: audioMessageId,
      inboundText: transcribedText,
    });
  }

  private async safeSend(replyJid: string, text: string): Promise<void> {
    try {
      await this.outbound.sendText(replyJid, text);
    } catch (err) {
      if (this.log) {
        this.log.error({ err, replyJid }, 'Falha ao enviar mensagem WhatsApp');
      } else {
        console.error('[ingest] Falha ao enviar WhatsApp', err);
      }
    }
  }

  private async tryHandlePending(
    userId: string,
    messageId: string,
    replyJid: string,
    text: string,
    userTimezone: string,
  ): Promise<boolean> {
    const active = await this.pending.findLatestActive(userId, new Date());
    if (!active) return false;

    if (active.contextType === PendingContextType.CONFIRM_AUDIO_TRANSCRIPT) {
      const payload = AudioTranscriptPayloadSchema.safeParse(active.payload);
      if (!payload.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      if (!isAffirmative(text)) {
        await this.pending.deleteById(active.id);
        return false;
      }
      await this.pending.deleteById(active.id);
      await this.runPipelineAfterAudioConfirm(
        userId,
        messageId,
        replyJid,
        payload.data.transcribedText,
        payload.data.userTimezone,
        payload.data.audioMessageId,
      );
      return true;
    }

    if (active.contextType === PendingContextType.CLARIFY_TRANSACTION_TYPE) {
      const draft = TransactionDraftPayloadSchema.safeParse(active.payload);
      if (!draft.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const t = parseTypeClarification(text);
      if (!t) {
        await this.safeSend(
          replyJid,
          'Preciso só saber: foi *despesa*, *receita* ou *transferência*?',
        );
        return true;
      }
      await this.pending.deleteById(active.id);
      const amount = new Decimal(draft.data.amount);
      const occurredAt = new Date(draft.data.occurredAt);
      const tx = await this.createTx.execute({
        userId,
        sourceMessageId: messageId,
        type: t,
        amount,
        currency: draft.data.currency,
        description: draft.data.description,
        normalizedDescription: draft.data.normalizedDescription,
        categoryId: draft.data.suggestedCategoryId,
        occurredAt,
        confidence: ConfidenceLevel.MEDIUM,
      });
      await this.replyCreated(
        replyJid,
        t,
        amount,
        tx.description,
        draft.data.suggestedCategoryId,
        userId,
      );
      return true;
    }

    if (active.contextType === PendingContextType.LOW_CONFIDENCE_CREATE) {
      const draft = TransactionDraftPayloadSchema.safeParse(active.payload);
      if (!draft.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const cats = await this.categories.listForUser(userId);

      if (isListCategoriesQuery(text)) {
        const t = draft.data.transactionType ?? null;
        const applicable = t ? categoriesApplicableToTransaction(cats, t) : cats;
        await this.safeSend(
          replyJid,
          replyCategoryOptionsWhilePending(
            applicable.map((c) => c.name),
            t,
          ),
        );
        return true;
      }

      if (isExplicitCancellation(text)) {
        await this.pending.deleteById(active.id);
        await this.safeSend(
          replyJid,
          'Beleza, *não salvei* esse lançamento. Quando quiser, manda de novo.',
        );
        return true;
      }

      const resolvedCategoryId = pickCategoryIdForLowConfidenceConfirm(
        text,
        draft.data.suggestedCategoryId,
        cats,
      );
      if (resolvedCategoryId !== null) {
        await this.pending.deleteById(active.id);
        const amount = new Decimal(draft.data.amount);
        const occurredAt = new Date(draft.data.occurredAt);
        const type = draft.data.transactionType;
        if (!type) {
          await this.safeSend(replyJid, 'Contexto inválido. Tente novamente.');
          return true;
        }
        await this.createTx.execute({
          userId,
          sourceMessageId: messageId,
          type,
          amount,
          currency: draft.data.currency,
          description: draft.data.description,
          normalizedDescription: draft.data.normalizedDescription,
          categoryId: resolvedCategoryId,
          occurredAt,
          confidence: ConfidenceLevel.MEDIUM,
        });
        await this.replyCreated(
          replyJid,
          type,
          amount,
          draft.data.description,
          resolvedCategoryId,
          userId,
        );
        return true;
      }

      const rules = await this.rules.listActiveForUser(userId);
      const reparsed = this.parser.parse({
        text,
        now: new Date(),
        userTimezone,
        rules,
        categories: cats,
        sourceConfidence: undefined,
      });
      if (isQueryIntentThatAbandonsPending(reparsed.intent)) {
        await this.pending.deleteById(active.id);
        return false;
      }
      if (isSameAmountCreateParsed(reparsed, draft.data)) {
        await this.pending.deleteById(active.id);
        await this.dispatchParsed(userId, messageId, replyJid, reparsed, userTimezone, {
          inboundText: text,
        });
        return true;
      }

      await this.safeSend(replyJid, replyPendingLowConfidenceReminder());
      return true;
    }

    return false;
  }

  private async handleLastCommand(
    userId: string,
    replyJid: string,
    cmd: ReturnType<typeof parseLastTransactionCommand>,
  ): Promise<void> {
    const last = await this.transactions.findLastForUser(userId);
    if (!last) {
      await this.safeSend(replyJid, 'Não encontrei lançamento recente.');
      return;
    }
    if (cmd.kind === 'DELETE_LAST') {
      const del = await this.transactions.softDelete(last.id, userId);
      if (!del) {
        await this.safeSend(replyJid, 'Não foi possível apagar.');
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_SOFT_DELETED',
        entityType: 'Transaction',
        entityId: last.id,
        before: { amount: last.amount.toString(), description: last.description },
      });
      await this.safeSend(replyJid, 'Último lançamento apagado.');
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_AMOUNT') {
      const updated = await this.transactions.updateAmount(last.id, userId, cmd.amount);
      if (!updated) {
        await this.safeSend(replyJid, 'Não foi possível atualizar o valor.');
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_AMOUNT_UPDATED',
        entityType: 'Transaction',
        entityId: last.id,
        before: { amount: last.amount.toString() },
        after: { amount: cmd.amount.toString() },
      });
      await this.safeSend(
        replyJid,
        `Valor atualizado para ${cmd.amount.toFixed(2).replace('.', ',')} BRL.`,
      );
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_CATEGORY') {
      const cats = await this.categories.listForUser(userId);
      const hint = normalizeForMatch(cmd.categoryHint);
      const match = cats.find(
        (c) => c.normalizedName.includes(hint) || hint.includes(c.normalizedName),
      );
      if (!match) {
        if (isListCategoriesQuery(cmd.categoryHint)) {
          const applicable = categoriesApplicableToTransaction(cats, last.type);
          await this.safeSend(
            replyJid,
            replyCategoryOptionsForLastTransaction(
              applicable.map((c) => c.name),
              last.type,
            ),
          );
          return;
        }
        await this.safeSend(
          replyJid,
          'Não achei essa categoria. Liste um nome próximo ao das categorias padrão.',
        );
        return;
      }
      const updated = await this.transactions.updateCategory(last.id, userId, match.id);
      if (!updated) {
        await this.safeSend(replyJid, 'Não foi possível atualizar a categoria.');
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_CATEGORY_UPDATED',
        entityType: 'Transaction',
        entityId: last.id,
        after: { categoryId: match.id },
      });
      await this.safeSend(replyJid, `Categoria atualizada para ${match.name}.`);
    }
  }

  private async dispatchParsed(
    userId: string,
    messageId: string,
    replyJid: string,
    parsed: ParseResult,
    timeZone: string,
    opts?: { transactionSourceMessageId?: string; inboundText?: string },
  ): Promise<void> {
    const txSourceMessageId = opts?.transactionSourceMessageId ?? messageId;
    const inboundText = opts?.inboundText ?? parsed.description;
    switch (parsed.intent) {
      case UserIntent.GREETING:
        await this.safeSend(replyJid, replyIntro());
        return;
      case UserIntent.HELP:
        await this.safeSend(replyJid, replyHelp());
        return;
      case UserIntent.GET_TODAY_SUMMARY: {
        const day = await this.reports.dailySummary(userId, timeZone);
        const breakdown = await this.reports.categoryBreakdownToday(userId, timeZone);
        const top = await this.reports.topExpensesToday(userId, timeZone, 5);
        await this.safeSend(replyJid, replyTodayLedger(day, breakdown, top));
        return;
      }
      case UserIntent.GET_MONTH_SUMMARY: {
        const { current, previous } = await this.reports.compareToPreviousMonth(userId, timeZone);
        const breakdown = await this.reports.categoryBreakdown(userId, timeZone);
        await this.safeSend(replyJid, replyMonthLedger(current, previous, breakdown));
        return;
      }
      case UserIntent.GET_CATEGORY_BREAKDOWN: {
        const rows = await this.reports.categoryBreakdown(userId, timeZone);
        await this.safeSend(replyJid, replyCategoryBreakdown(rows));
        return;
      }
      case UserIntent.GET_TOP_EXPENSES: {
        const txs = await this.reports.topExpenses(userId, timeZone, 5);
        await this.safeSend(replyJid, replyTopExpenses(txs));
        return;
      }
      case UserIntent.GET_LAST_TRANSACTIONS: {
        const txs = await this.reports.latestTransactions(userId, 8);
        await this.safeSend(replyJid, replyLatestTransactions(txs));
        return;
      }
      case UserIntent.GET_RECURRING_EXPENSES: {
        const list = await this.recurrence.listForUser(userId);
        await this.safeSend(
          replyJid,
          replyRecurring(
            list.map((r) => ({
              description: r.description,
              frequency: r.frequency,
              amount: r.estimatedAmount ? r.estimatedAmount.toString() : null,
            })),
          ),
        );
        return;
      }
      default:
        break;
    }

    if (
      parsed.intent === UserIntent.CREATE_EXPENSE ||
      parsed.intent === UserIntent.CREATE_INCOME ||
      parsed.intent === UserIntent.CREATE_TRANSFER
    ) {
      if (!parsed.amount || !parsed.transactionType) return;

      if (parsed.status === ParseStatus.NEEDS_CONFIRMATION && parsed.clarification) {
        const isTypeClarification = parsed.clarification.includes(
          'despesa, receita ou transferência',
        );
        if (isTypeClarification) {
          await this.pending.create({
            userId,
            messageId,
            contextType: PendingContextType.CLARIFY_TRANSACTION_TYPE,
            payload: {
              amount: parsed.amount.toString(),
              currency: parsed.currency,
              occurredAt: parsed.occurredAt.toISOString(),
              description: parsed.description,
              normalizedDescription: parsed.normalizedDescription,
              suggestedCategoryId: parsed.suggestedCategoryId ?? null,
            },
            expiresAt: addHours(new Date(), 24),
          });
        } else {
          await this.pending.create({
            userId,
            messageId,
            contextType: PendingContextType.LOW_CONFIDENCE_CREATE,
            payload: {
              amount: parsed.amount.toString(),
              currency: parsed.currency,
              occurredAt: parsed.occurredAt.toISOString(),
              description: parsed.description,
              normalizedDescription: parsed.normalizedDescription,
              suggestedCategoryId: parsed.suggestedCategoryId ?? null,
              transactionType: parsed.transactionType,
              originalUserText: inboundText,
            },
            expiresAt: addHours(new Date(), 24),
          });
        }
        if (!isTypeClarification && parsed.confidence === ConfidenceLevel.LOW && parsed.clarification) {
          await this.safeSend(replyJid, extendLowConfidenceClarification(parsed.clarification));
        } else if (parsed.clarification) {
          await this.safeSend(replyJid, parsed.clarification);
        }
        return;
      }

      await this.createTx.execute({
        userId,
        sourceMessageId: txSourceMessageId,
        type: parsed.transactionType,
        amount: parsed.amount,
        currency: parsed.currency,
        description: parsed.description,
        normalizedDescription: parsed.normalizedDescription,
        categoryId: parsed.suggestedCategoryId,
        occurredAt: parsed.occurredAt,
        confidence: parsed.confidence,
      });
      await this.replyCreated(
        replyJid,
        parsed.transactionType,
        parsed.amount,
        parsed.description,
        parsed.suggestedCategoryId,
        userId,
      );
      return;
    }

    if (parsed.clarification) {
      await this.safeSend(replyJid, parsed.clarification);
    } else {
      await this.safeSend(replyJid, replySoftUnknown());
    }
  }

  private async replyCreated(
    replyJid: string,
    type: TransactionType,
    amount: Decimal,
    description: string,
    categoryId: string | null | undefined,
    userId: string,
  ): Promise<void> {
    const cats = await this.categories.listForUser(userId);
    const cat = categoryId ? cats.find((c) => c.id === categoryId) : undefined;
    const place = description.slice(0, 40);
    if (type === TransactionType.EXPENSE) {
      await this.safeSend(
        replyJid,
        replyExpenseRegistered(amount, place, cat?.name ?? 'Outros'),
      );
      return;
    }
    if (type === TransactionType.INCOME) {
      await this.safeSend(replyJid, replyIncomeRegistered(amount, place));
      return;
    }
    await this.safeSend(replyJid, replyTransferRegistered(amount, place));
  }
}
