import type { Category, Prisma, ReminderSource } from '@prisma/client';
import {
  ConfidenceLevel,
  MessageDirection,
  MessageProvider,
  MessageType,
  TransactionType,
} from '../../../shared/types/prisma-enums.js';
import { Decimal } from 'decimal.js';
import { addHours } from 'date-fns';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import type { NormalizedIngestMessage } from '../../../shared/domain/ingest-message.js';
import { accountKeyFromWaChatJid } from '../../../shared/utils/whatsapp-jid.js';
import { UserIntent, ParseStatus, type UserIntentType } from '../../../shared/types/intent.js';
import { unlinkIgnoreMissing } from '../../../shared/utils/unlink-ignore-missing.js';
import { normalizeDescription, normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import { matchesResetUserDataCommand } from '../../../shared/utils/reset-user-data-command.js';
import { isMoneyOnlySegment } from '../../../shared/utils/split-financial-segments.js';
import { normalizeVoiceNoteText } from '../../../shared/utils/voice-transcript-normalize.js';
import type { AuditService } from '../../audit/application/audit.service.js';
import type { CategoryRepository } from '../../categories/infra/category.repository.js';
import { PendingContextType } from '../../confirmations/domain/pending-context.js';
import { AudioTranscriptPayloadSchema } from '../../confirmations/dto/audio-transcript.payload.js';
import { ReceiptOcrConfirmPayloadSchema } from '../../confirmations/dto/receipt-ocr-confirm.payload.js';
import { ReportScopePayloadSchema } from '../../confirmations/dto/report-scope.payload.js';
import { TransactionDraftPayloadSchema } from '../../confirmations/dto/transaction-draft.payload.js';
import type { PendingConfirmationRepository } from '../../confirmations/infra/pending-confirmation.repository.js';
import { MediaStorageService } from '../../media/application/media-storage.service.js';
import { TesseractOcrProvider } from '../../media/infra/tesseract-ocr.provider.js';
import { WhisperCliTranscriptionProvider } from '../../media/infra/whisper-cli.transcription.provider.js';
import {
  interpretBrazilianReceipt,
  resolveReceiptOccurredAtUtc,
} from '../../receipts/application/brazilian-receipt.interpreter.js';
import { appCategoryNameFromReceiptTipo } from '../../receipts/application/map-receipt-tipo-to-category.js';
import type { ReceiptInterpretation } from '../../receipts/domain/receipt-interpretation.js';
import { receiptInterpretationToJson } from '../../receipts/domain/receipt-interpretation.js';
import { FinancialParserService } from '../../parser/application/financial-parser.service.js';
import type { ParseResult } from '../../parser/domain/parse-result.js';
import type { RecurrenceDetectorService } from '../../recurrence/application/recurrence-detector.service.js';
import type { ReportsService } from '../../reports/application/reports.service.js';
import type { RuleRepository } from '../../rules/infra/rule.repository.js';
import type { CreateTransactionUseCase } from '../../transactions/application/create-transaction.use-case.js';
import {
  parseLastTransactionCommand,
  prepareTransactionInboundSegments,
} from '../../transactions/application/last-transaction-commands.js';
import type { TransactionRepository } from '../../transactions/infra/transaction.repository.js';
import type { TransactionDraftPayload } from '../../confirmations/dto/transaction-draft.payload.js';
import type { OutboundMessagesPort } from '../../whatsapp/ports/outbound-messages.port.js';
import {
  TRANSACTION_TYPE_CHOICE_PHRASE,
  replyAskReportScope,
  replyAudioTranscriptionPreview,
  replyCancelLowConfidence,
  replyCompoundBatchIntro,
  replyCompoundStoppedForConfirmation,
  replyCategoryBreakdown,
  replyCategoryOptionsForLastTransaction,
  replyCategoryOptionsWhilePending,
  replyClarifyTransactionTypeAgain,
  replyInvalidPendingContext,
  replyLastTxAmountFail,
  replyLastTxAmountNeedsValue,
  replyLastTxAmountUpdated,
  replyLastTxCategoryNotFound,
  replyLastTxCategoryUpdateFail,
  replyLastTxCategoryUpdated,
  replyLastTxDeleteFail,
  replyLastTxDeleted,
  replyLastTxNotFound,
  extendLowConfidenceClarification,
  replyExpenseRegistered,
  replyHelp,
  replyAccountDataWiped,
  firstNameFromPush,
  replyIncomeRegistered,
  replyIntro,
  replyLatestTransactions,
  replyOnboardingWelcome,
  replyMoneyOnlyNotLancamento,
  replyMonthLedger,
  replyNoTextInMessage,
  replyPendingLowConfidenceReminder,
  replyRecurring,
  replyReportScopeUnclear,
  replySoftUnknown,
  replyTodayLedger,
  replyTopExpenses,
  replyTranscriptionEmpty,
  replyTransferRegistered,
  replyReceiptOcrPreview,
  replyReceiptOcrDismissed,
  occurrenceLabelForReply,
} from '../../whatsapp/presentation/bot-replies.js';
import type { EnsureUserUseCase } from '../../users/application/ensure-user.use-case.js';
import type { UserRepository } from '../../users/infra/user.repository.js';
import type { RemindersAppService } from '../../reminders/application/reminders.app-service.js';
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

function isSameAmountCreateParsed(parsed: ParseResult, draft: TransactionDraftPayload): boolean {
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

function parseReportScopeReply(text: string): 'DAY' | 'MONTH' | null {
  const n = normalizeForMatch(text);
  if (n.length > 48) return null;
  const monthWords =
    /\b(este mes|este mês|esse mes|esse mês|neste mes|neste mês|mes atual|mês atual|mensal)\b/.test(
      n,
    ) ||
    /\bdo mes\b/.test(n) ||
    /\bdo mês\b/.test(n) ||
    /^mes$/u.test(n) ||
    /^mês$/u.test(n);
  const dayWords =
    /\b(hoje|hj|neste dia|nesse dia|agora)\b/.test(n) || /\bdo dia\b/.test(n) || /^dia$/u.test(n);
  if (monthWords && !dayWords) return 'MONTH';
  if (dayWords && !monthWords) return 'DAY';
  if (dayWords && monthWords) return 'DAY';
  return null;
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
    case UserIntent.CLARIFY_REPORT_PERIOD:
      return true;
    default:
      return false;
  }
}

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
    private readonly users: UserRepository,
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
    private readonly reminders: RemindersAppService,
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
      displayName: event.pushName ?? undefined,
      waChatJid: event.waChatJid,
      timezone: env.DEFAULT_TIMEZONE,
      locale: env.DEFAULT_LOCALE,
    });

    const existing = await this.messages.findByProviderId(
      user.id,
      MessageProvider.WHATSAPP,
      event.providerMessageId,
    );
    if (existing) return;

    const inboundCountBefore = await this.messages.countInboundForUser(user.id);
    const isFirstInbound = inboundCountBefore === 0;

    const rawText = event.rawText;
    let processedText = rawText;
    let mediaPath: string | null = null;
    let sourceConfidence: ConfidenceLevel | undefined;
    let receiptOcrOffer: ReceiptInterpretation | null = null;

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

    await this.users.recordInboundActivity(user.id, replyJid, event.receivedAt);

    const quickPlainText = (rawText ?? '').replace(/\s+/g, ' ').trim();
    const quickSegs = prepareTransactionInboundSegments(quickPlainText);
    const skipWelcomeForReset =
      quickSegs.length === 1 && matchesResetUserDataCommand(quickSegs[0] ?? '');

    let suppressGreetingReply = false;
    if (user.onboardingWelcomeSentAt == null && isFirstInbound && !skipWelcomeForReset) {
      const who = firstNameFromPush(user.displayName ?? event.pushName);
      await this.safeSend(replyJid, replyOnboardingWelcome(who));
      await this.users.markOnboardingWelcomeSent(user.id, new Date());
      suppressGreetingReply = true;
    }

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
          const ocrTrim = processedText.trim();
          if (ocrTrim.length > 0) {
            const receipt = interpretBrazilianReceipt(ocrTrim);
            if (
              receipt.valor_total > 0 &&
              (receipt.confianca === 'alta' || receipt.confianca === 'media')
            ) {
              receiptOcrOffer = receipt;
            }
          }
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
        const fromTranscription = tr.text.trim();
        const rawTranscript = (
          fromTranscription !== '' ? fromTranscription : (rawText ?? '')
        ).trim();
        const normalizedVoice = normalizeVoiceNoteText(rawTranscript);
        processedText = normalizedVoice !== '' ? normalizedVoice : rawTranscript;
        sourceConfidence = tr.confidence;
        if (!tr.text.trim()) {
          await this.safeSend(replyJid, replyTranscriptionEmpty());
        }
      }
    }

    const messageMetadata: Prisma.InputJsonValue = {
      mediaPath,
      sourceConfidence,
      ...(receiptOcrOffer !== null
        ? {
            receiptInterpretation: receiptInterpretationToJson(
              receiptOcrOffer,
            ) as Prisma.JsonObject,
          }
        : {}),
    };

    await this.messages.updateMetadata(msg.id, {
      processedText,
      metadata: messageMetadata,
    });

    if (receiptOcrOffer !== null) {
      const cats = await this.categories.listForUser(user.id);
      const targetName = appCategoryNameFromReceiptTipo(receiptOcrOffer.tipo);
      const cat = cats.find((c) => normalizeForMatch(c.name) === normalizeForMatch(targetName));
      const desc = receiptOcrOffer.estabelecimento.slice(0, 120);
      const occurredAt = resolveReceiptOccurredAtUtc(
        receiptOcrOffer.data,
        event.receivedAt,
        user.timezone,
      );
      await this.pending.deleteForUser(user.id);
      await this.pending.create({
        userId: user.id,
        messageId: msg.id,
        contextType: PendingContextType.CONFIRM_RECEIPT_OCR,
        payload: {
          amount: new Decimal(receiptOcrOffer.valor_total).toFixed(2),
          currency: 'BRL',
          description: desc,
          normalizedDescription: normalizeDescription(desc),
          categoryId: cat?.id ?? null,
          occurredAt: occurredAt.toISOString(),
          userTimezone: user.timezone,
          imageMessageId: msg.id,
        },
        expiresAt: addHours(new Date(), 24),
      });
      await this.safeSend(replyJid, replyReceiptOcrPreview(receiptOcrOffer));
      return;
    }

    const textForPipeline = (processedText ?? '').replace(/\s+/g, ' ').trim();
    if (!textForPipeline) {
      await this.safeSend(replyJid, replyNoTextInMessage());
      return;
    }

    const resetSegments = prepareTransactionInboundSegments(textForPipeline);
    if (resetSegments.length === 1 && matchesResetUserDataCommand(resetSegments[0] ?? '')) {
      const paths = await this.messages.listMediaPathsForUser(user.id);
      for (const p of paths) {
        try {
          await unlinkIgnoreMissing(p);
        } catch (err: unknown) {
          if (this.log)
            this.log.warn({ err, path: p }, 'Falha ao apagar arquivo de mídia no reset');
          else console.error('[ingest] mídia no reset', err);
        }
      }
      await this.users.wipeClientData(user.id);
      await this.safeSend(replyJid, replyAccountDataWiped());
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

    await this.processInboundTextAfterPending(
      user.id,
      msg.id,
      replyJid,
      textForPipeline,
      user.timezone,
      sourceConfidence,
      { reminderSource: 'TEXT', suppressGreetingReply },
    );
  }

  private async processInboundTextAfterPending(
    userId: string,
    messageId: string,
    replyJid: string,
    text: string,
    userTimezone: string,
    sourceConfidence: ConfidenceLevel | undefined,
    opts?: {
      transactionSourceMessageId?: string;
      reminderSource?: ReminderSource;
      /** Evita segundo “oi” após boas-vindas na primeira mensagem. */
      suppressGreetingReply?: boolean;
    },
  ): Promise<void> {
    const reminderSource: ReminderSource = opts?.reminderSource ?? 'TEXT';
    const segments = prepareTransactionInboundSegments(text);
    if (segments.length > 1) {
      await this.pending.deleteForUser(userId);
      await this.safeSend(replyJid, replyCompoundBatchIntro(segments.length));
    }

    const rules = await this.rules.listActiveForUser(userId);
    const cats = await this.categories.listForUser(userId);

    for (const [i, seg] of segments.entries()) {
      const cmd = parseLastTransactionCommand(seg);
      if (cmd.kind !== 'NONE') {
        await this.handleLastCommand(userId, replyJid, cmd);
        continue;
      }

      if (isMoneyOnlySegment(seg)) {
        await this.safeSend(replyJid, replyMoneyOnlyNotLancamento());
        continue;
      }

      const now = new Date();
      const reminderResult = await this.reminders.handleInbound(
        userId,
        seg,
        userTimezone,
        reminderSource,
        messageId,
        now,
      );
      if (reminderResult.handled) {
        await this.safeSend(replyJid, reminderResult.message);
        continue;
      }

      const parsed = this.parser.parse({
        text: seg,
        now,
        userTimezone,
        rules,
        categories: cats,
        sourceConfidence,
      });

      await this.messages.updateMetadata(messageId, {
        intent: parsed.intent,
        confidence: parsed.confidence,
      });

      await this.dispatchParsed(userId, messageId, replyJid, parsed, userTimezone, {
        inboundText: seg,
        transactionSourceMessageId: opts?.transactionSourceMessageId,
        suppressGreetingReply: opts?.suppressGreetingReply,
      });

      const pendingNow = await this.pending.findLatestActive(userId, new Date());
      if (pendingNow !== null && i < segments.length - 1) {
        await this.safeSend(replyJid, replyCompoundStoppedForConfirmation(segments.length - i - 1));
        break;
      }
    }
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

    await this.processInboundTextAfterPending(
      userId,
      confirmMessageId,
      replyJid,
      transcribedText.trim(),
      userTimezone,
      sourceConfidence,
      { transactionSourceMessageId: audioMessageId, reminderSource: 'AUDIO' },
    );
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

    if (active.contextType === PendingContextType.CONFIRM_RECEIPT_OCR) {
      const payload = ReceiptOcrConfirmPayloadSchema.safeParse(active.payload);
      if (!payload.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      if (isExplicitCancellation(text)) {
        await this.pending.deleteById(active.id);
        await this.safeSend(replyJid, replyReceiptOcrDismissed());
        return true;
      }
      if (!isAffirmative(text)) {
        await this.pending.deleteById(active.id);
        return false;
      }
      await this.pending.deleteById(active.id);
      const amount = new Decimal(payload.data.amount);
      const occurredAt = new Date(payload.data.occurredAt);
      const tx = await this.createTx.execute({
        userId,
        sourceMessageId: messageId,
        type: TransactionType.EXPENSE,
        amount,
        currency: payload.data.currency,
        description: payload.data.description,
        normalizedDescription: payload.data.normalizedDescription,
        categoryId: payload.data.categoryId,
        occurredAt,
        confidence: ConfidenceLevel.MEDIUM,
      });
      await this.replyCreated(
        replyJid,
        TransactionType.EXPENSE,
        amount,
        tx.description,
        tx.categoryId,
        userId,
        tx.occurredAt,
        payload.data.userTimezone,
      );
      return true;
    }

    if (active.contextType === PendingContextType.CLARIFY_REPORT_PERIOD) {
      const payload = ReportScopePayloadSchema.safeParse(active.payload);
      if (!payload.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const n = normalizeForMatch(text);
      if (/\b(ajuda|help)\b/.test(n)) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const scope = parseReportScopeReply(text);
      if (!scope) {
        await this.safeSend(replyJid, replyReportScopeUnclear());
        return true;
      }
      await this.pending.deleteById(active.id);
      if (scope === 'DAY') {
        const day = await this.reports.dailySummary(userId, userTimezone);
        const breakdown = await this.reports.categoryBreakdownToday(userId, userTimezone);
        const top = await this.reports.topExpensesToday(userId, userTimezone, 5);
        await this.safeSend(replyJid, replyTodayLedger(day, breakdown, top));
      } else {
        const { current, previous } = await this.reports.compareToPreviousMonth(
          userId,
          userTimezone,
        );
        const breakdown = await this.reports.categoryBreakdown(userId, userTimezone);
        await this.safeSend(replyJid, replyMonthLedger(current, previous, breakdown));
      }
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
        await this.safeSend(replyJid, replyClarifyTransactionTypeAgain());
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
        tx.occurredAt,
        userTimezone,
      );
      return true;
    }

    if (active.contextType === PendingContextType.LOW_CONFIDENCE_CREATE) {
      const draft = TransactionDraftPayloadSchema.safeParse(active.payload);
      if (!draft.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const remProbe = this.reminders.parseUtterance(text, new Date(), userTimezone);
      if (remProbe.kind !== 'NONE') {
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
        await this.safeSend(replyJid, replyCancelLowConfidence());
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
          await this.safeSend(replyJid, replyInvalidPendingContext());
          return true;
        }
        const tx = await this.createTx.execute({
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
          tx.description,
          resolvedCategoryId,
          userId,
          tx.occurredAt,
          userTimezone,
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
      await this.safeSend(replyJid, replyLastTxNotFound());
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_AMOUNT_NEEDS_VALUE') {
      await this.safeSend(replyJid, replyLastTxAmountNeedsValue());
      return;
    }
    if (cmd.kind === 'DELETE_LAST') {
      const del = await this.transactions.softDelete(last.id, userId);
      if (!del) {
        await this.safeSend(replyJid, replyLastTxDeleteFail());
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_SOFT_DELETED',
        entityType: 'Transaction',
        entityId: last.id,
        before: { amount: last.amount.toString(), description: last.description },
      });
      await this.safeSend(replyJid, replyLastTxDeleted());
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_AMOUNT') {
      const updated = await this.transactions.updateAmount(last.id, userId, cmd.amount);
      if (!updated) {
        await this.safeSend(replyJid, replyLastTxAmountFail());
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
      await this.safeSend(replyJid, replyLastTxAmountUpdated(cmd.amount));
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
        await this.safeSend(replyJid, replyLastTxCategoryNotFound());
        return;
      }
      const updated = await this.transactions.updateCategory(last.id, userId, match.id);
      if (!updated) {
        await this.safeSend(replyJid, replyLastTxCategoryUpdateFail());
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_CATEGORY_UPDATED',
        entityType: 'Transaction',
        entityId: last.id,
        after: { categoryId: match.id },
      });
      await this.safeSend(replyJid, replyLastTxCategoryUpdated(match.name));
    }
  }

  private async dispatchParsed(
    userId: string,
    messageId: string,
    replyJid: string,
    parsed: ParseResult,
    timeZone: string,
    opts?: {
      transactionSourceMessageId?: string;
      inboundText?: string;
      suppressGreetingReply?: boolean;
    },
  ): Promise<void> {
    const txSourceMessageId = opts?.transactionSourceMessageId ?? messageId;
    const inboundText = opts?.inboundText ?? parsed.description;
    switch (parsed.intent) {
      case UserIntent.GREETING:
        if (opts?.suppressGreetingReply) return;
        await this.safeSend(replyJid, replyIntro());
        return;
      case UserIntent.HELP:
        await this.safeSend(replyJid, replyHelp());
        return;
      case UserIntent.CLARIFY_REPORT_PERIOD:
        await this.pending.deleteForUser(userId);
        await this.pending.create({
          userId,
          messageId,
          contextType: PendingContextType.CLARIFY_REPORT_PERIOD,
          payload: {},
          expiresAt: addHours(new Date(), 24),
        });
        await this.safeSend(replyJid, replyAskReportScope());
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
        const isTypeClarification = parsed.clarification.includes(TRANSACTION_TYPE_CHOICE_PHRASE);
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
        if (
          !isTypeClarification &&
          parsed.confidence === ConfidenceLevel.LOW &&
          parsed.clarification
        ) {
          await this.safeSend(replyJid, extendLowConfidenceClarification(parsed.clarification));
        } else if (parsed.clarification) {
          await this.safeSend(replyJid, parsed.clarification);
        }
        return;
      }

      const tx = await this.createTx.execute({
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
        tx.description,
        parsed.suggestedCategoryId,
        userId,
        tx.occurredAt,
        timeZone,
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
    occurredAt: Date,
    userTimezone: string,
  ): Promise<void> {
    const cats = await this.categories.listForUser(userId);
    const cat = categoryId ? cats.find((c) => c.id === categoryId) : undefined;
    const place = description.slice(0, 40);
    const dateLabel = occurrenceLabelForReply(occurredAt, new Date(), userTimezone);
    let dayBalance: Decimal | undefined;
    try {
      const day = await this.reports.dailySummary(userId, userTimezone);
      dayBalance = day.balance;
    } catch {
      dayBalance = undefined;
    }
    if (type === TransactionType.EXPENSE) {
      await this.safeSend(
        replyJid,
        replyExpenseRegistered(amount, place, cat?.name ?? 'Outros', dateLabel, dayBalance),
      );
      return;
    }
    if (type === TransactionType.INCOME) {
      await this.safeSend(replyJid, replyIncomeRegistered(amount, place, dateLabel, dayBalance));
      return;
    }
    await this.safeSend(replyJid, replyTransferRegistered(amount, place, dateLabel, dayBalance));
  }
}
