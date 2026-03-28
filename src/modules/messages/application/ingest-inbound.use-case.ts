import {
  ConfidenceLevel,
  MessageDirection,
  MessageProvider,
  MessageType,
  TransactionType,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { addHours } from 'date-fns';
import { env } from '../../../config/env.js';
import type { NormalizedIngestMessage } from '../../../shared/domain/ingest-message.js';
import { UserIntent, ParseStatus } from '../../../shared/types/intent.js';
import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';
import type { AuditService } from '../../audit/application/audit.service.js';
import type { CategoryRepository } from '../../categories/infra/category.repository.js';
import { PendingContextType } from '../../confirmations/domain/pending-context.js';
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
import type { OutboundMessagesPort } from '../../whatsapp/ports/outbound-messages.port.js';
import {
  replyCategoryBreakdown,
  replyExpenseRegistered,
  replyHelp,
  replyIncomeRegistered,
  replyLatestTransactions,
  replyMonthlySummary,
  replyRecurring,
  replyTopExpenses,
  replyTransferRegistered,
} from '../../whatsapp/presentation/bot-replies.js';
import type { EnsureUserUseCase } from '../../users/application/ensure-user.use-case.js';
import type { MessageRepository } from '../infra/message.repository.js';

function jidToDigits(jid: string): string {
  return jid.replace(/\D/g, '').slice(-15);
}

function parseTypeClarification(text: string): TransactionType | null {
  const n = normalizeForMatch(text);
  if (/\b(despesa|gasto|debito|débito)\b/.test(n)) return TransactionType.EXPENSE;
  if (/\b(receita|entrada|credito|crédito)\b/.test(n)) return TransactionType.INCOME;
  if (/\b(transferencia|transferência|pix envio)\b/.test(n)) return TransactionType.TRANSFER;
  return null;
}

function isAffirmative(text: string): boolean {
  const n = normalizeForMatch(text);
  return /^(sim|s|ok|confirmo|isso|certo)\b/.test(n);
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
  ) {}

  async execute(
    event: NormalizedIngestMessage,
    media?: { download: () => Promise<Buffer | null>; suggestedExtension: string },
  ): Promise<void> {
    const digits = jidToDigits(event.fromWhatsAppNumber);
    const user = await this.ensureUser.execute({
      whatsappNumber: digits,
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

    if (media && (event.messageType === MessageType.IMAGE || event.messageType === MessageType.DOCUMENT)) {
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
        processedText = tr.text || rawText || '';
        sourceConfidence = tr.confidence;
        if (!tr.text.trim()) {
          await this.outbound.sendText(
            digits,
            'Não consegui transcrever o áudio. Instale/configure whisper.cpp e ffmpeg (veja README) ou descreva por texto.',
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

    const textForPipeline = (processedText ?? '').trim();
    if (!textForPipeline) {
      await this.outbound.sendText(digits, 'Mensagem vazia. Envie texto, áudio ou imagem com valor legível.');
      return;
    }

    const pendingHandled = await this.tryHandlePending(user.id, msg.id, digits, textForPipeline);
    if (pendingHandled) return;

    const cmd = parseLastTransactionCommand(textForPipeline);
    if (cmd.kind !== 'NONE') {
      await this.handleLastCommand(user.id, digits, cmd);
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

    await this.dispatchParsed(user.id, msg.id, digits, parsed, user.timezone);
  }

  private async tryHandlePending(
    userId: string,
    messageId: string,
    digits: string,
    text: string,
  ): Promise<boolean> {
    const active = await this.pending.findLatestActive(userId, new Date());
    if (!active) return false;

    if (active.contextType === PendingContextType.CLARIFY_TRANSACTION_TYPE) {
      const draft = TransactionDraftPayloadSchema.safeParse(active.payload);
      if (!draft.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      const t = parseTypeClarification(text);
      if (!t) {
        await this.outbound.sendText(digits, 'Responda com: despesa, receita ou transferência.');
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
      await this.replyCreated(digits, t, amount, tx.description, draft.data.suggestedCategoryId, userId);
      return true;
    }

    if (active.contextType === PendingContextType.LOW_CONFIDENCE_CREATE) {
      const draft = TransactionDraftPayloadSchema.safeParse(active.payload);
      if (!draft.success) {
        await this.pending.deleteById(active.id);
        return false;
      }
      if (!isAffirmative(text)) {
        await this.outbound.sendText(digits, 'Ok, não registrei. Envie o lançamento novamente com mais detalhes.');
        await this.pending.deleteById(active.id);
        return true;
      }
      await this.pending.deleteById(active.id);
      const amount = new Decimal(draft.data.amount);
      const occurredAt = new Date(draft.data.occurredAt);
      const type = draft.data.transactionType;
      if (!type) {
        await this.outbound.sendText(digits, 'Contexto inválido. Tente novamente.');
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
        categoryId: draft.data.suggestedCategoryId,
        occurredAt,
        confidence: ConfidenceLevel.MEDIUM,
      });
      await this.replyCreated(digits, type, amount, draft.data.description, draft.data.suggestedCategoryId, userId);
      return true;
    }

    return false;
  }

  private async handleLastCommand(
    userId: string,
    digits: string,
    cmd: ReturnType<typeof parseLastTransactionCommand>,
  ): Promise<void> {
    const last = await this.transactions.findLastForUser(userId);
    if (!last) {
      await this.outbound.sendText(digits, 'Não encontrei lançamento recente.');
      return;
    }
    if (cmd.kind === 'DELETE_LAST') {
      const del = await this.transactions.softDelete(last.id, userId);
      if (!del) {
        await this.outbound.sendText(digits, 'Não foi possível apagar.');
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_SOFT_DELETED',
        entityType: 'Transaction',
        entityId: last.id,
        before: { amount: last.amount.toString(), description: last.description },
      });
      await this.outbound.sendText(digits, 'Último lançamento apagado.');
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_AMOUNT') {
      const updated = await this.transactions.updateAmount(last.id, userId, cmd.amount);
      if (!updated) {
        await this.outbound.sendText(digits, 'Não foi possível atualizar o valor.');
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
      await this.outbound.sendText(digits, `Valor atualizado para ${cmd.amount.toFixed(2).replace('.', ',')} BRL.`);
      return;
    }
    if (cmd.kind === 'UPDATE_LAST_CATEGORY') {
      const cats = await this.categories.listForUser(userId);
      const hint = normalizeForMatch(cmd.categoryHint);
      const match = cats.find((c) => c.normalizedName.includes(hint) || hint.includes(c.normalizedName));
      if (!match) {
        await this.outbound.sendText(digits, 'Não achei essa categoria. Liste um nome próximo ao das categorias padrão.');
        return;
      }
      const updated = await this.transactions.updateCategory(last.id, userId, match.id);
      if (!updated) {
        await this.outbound.sendText(digits, 'Não foi possível atualizar a categoria.');
        return;
      }
      await this.audit.log({
        userId,
        action: 'TRANSACTION_CATEGORY_UPDATED',
        entityType: 'Transaction',
        entityId: last.id,
        after: { categoryId: match.id },
      });
      await this.outbound.sendText(digits, `Categoria atualizada para ${match.name}.`);
    }
  }

  private async dispatchParsed(
    userId: string,
    messageId: string,
    digits: string,
    parsed: ParseResult,
    timeZone: string,
  ): Promise<void> {
    switch (parsed.intent) {
      case UserIntent.HELP:
        await this.outbound.sendText(digits, replyHelp());
        return;
      case UserIntent.GET_MONTH_SUMMARY: {
        const { current, previous } = await this.reports.compareToPreviousMonth(userId, timeZone);
        let text = replyMonthlySummary(current);
        const deltaExp = current.expense.minus(previous.expense);
        const dir = deltaExp.gt(0) ? 'a mais' : deltaExp.lt(0) ? 'a menos' : 'iguais';
        text += ` Despesas vs mês anterior: ${dir} (${deltaExp.abs().toFixed(2)} BRL em valor absoluto).`;
        await this.outbound.sendText(digits, text);
        return;
      }
      case UserIntent.GET_CATEGORY_BREAKDOWN: {
        const rows = await this.reports.categoryBreakdown(userId, timeZone);
        await this.outbound.sendText(digits, replyCategoryBreakdown(rows));
        return;
      }
      case UserIntent.GET_TOP_EXPENSES: {
        const txs = await this.reports.topExpenses(userId, timeZone, 5);
        await this.outbound.sendText(digits, replyTopExpenses(txs));
        return;
      }
      case UserIntent.GET_LAST_TRANSACTIONS: {
        const txs = await this.reports.latestTransactions(userId, 8);
        await this.outbound.sendText(digits, replyLatestTransactions(txs));
        return;
      }
      case UserIntent.GET_RECURRING_EXPENSES: {
        const list = await this.recurrence.listForUser(userId);
        await this.outbound.sendText(
          digits,
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
        const isTypeClarification = parsed.clarification.includes('despesa, receita ou transferência');
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
            },
            expiresAt: addHours(new Date(), 24),
          });
        }
        await this.outbound.sendText(digits, parsed.clarification);
        if (!isTypeClarification && parsed.confidence === ConfidenceLevel.LOW) {
          await this.outbound.sendText(digits, 'Se estiver certo, responda "sim".');
        }
        return;
      }

      await this.createTx.execute({
        userId,
        sourceMessageId: messageId,
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
        digits,
        parsed.transactionType,
        parsed.amount,
        parsed.description,
        parsed.suggestedCategoryId,
        userId,
      );
      return;
    }

    if (parsed.clarification) {
      await this.outbound.sendText(digits, parsed.clarification);
    } else {
      await this.outbound.sendText(digits, 'Não entendi. Diga "ajuda" para ver exemplos.');
    }
  }

  private async replyCreated(
    digits: string,
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
      await this.outbound.sendText(
        digits,
        replyExpenseRegistered(amount, place, cat?.name ?? 'Outros'),
      );
      return;
    }
    if (type === TransactionType.INCOME) {
      await this.outbound.sendText(digits, replyIncomeRegistered(amount, place));
      return;
    }
    await this.outbound.sendText(digits, replyTransferRegistered(amount, place));
  }
}
