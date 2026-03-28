import type { OutboundMessagesPort } from '../modules/whatsapp/ports/outbound-messages.port.js';
import { BaileysService } from '../modules/whatsapp/infra/baileys.service.js';
import { AuditService } from '../modules/audit/application/audit.service.js';
import { CategoryRepository } from '../modules/categories/infra/category.repository.js';
import { PendingConfirmationRepository } from '../modules/confirmations/infra/pending-confirmation.repository.js';
import { IngestInboundUseCase } from '../modules/messages/application/ingest-inbound.use-case.js';
import { MessageRepository } from '../modules/messages/infra/message.repository.js';
import { RecurrenceDetectorService } from '../modules/recurrence/application/recurrence-detector.service.js';
import { ReportsService } from '../modules/reports/application/reports.service.js';
import { RuleRepository } from '../modules/rules/infra/rule.repository.js';
import { CreateTransactionUseCase } from '../modules/transactions/application/create-transaction.use-case.js';
import { TransactionRepository } from '../modules/transactions/infra/transaction.repository.js';
import { EnsureUserUseCase } from '../modules/users/application/ensure-user.use-case.js';
import { UserRepository } from '../modules/users/infra/user.repository.js';
import type { Logger } from 'pino';

export interface AppWiring {
  ingest: IngestInboundUseCase;
  baileys: BaileysService;
  reports: ReportsService;
  transactions: TransactionRepository;
  users: UserRepository;
}

export function buildWiring(logger?: Logger): AppWiring {
  const users = new UserRepository();
  const messages = new MessageRepository();
  const transactions = new TransactionRepository();
  const categories = new CategoryRepository();
  const rules = new RuleRepository();
  const pending = new PendingConfirmationRepository();
  const audit = new AuditService();
  const recurrence = new RecurrenceDetectorService();
  const reports = new ReportsService(transactions, categories);
  const ensureUser = new EnsureUserUseCase(users);
  const createTx = new CreateTransactionUseCase(transactions, audit, recurrence);

  const baileysHolder: { service: BaileysService | null } = { service: null };

  const outbound: OutboundMessagesPort = {
    async sendText(digits: string, text: string): Promise<void> {
      const svc = baileysHolder.service;
      if (!svc) {
        throw new Error('WhatsApp ainda não inicializado');
      }
      await svc.sendText(digits, text);
    },
  };

  const ingest = new IngestInboundUseCase(
    ensureUser,
    messages,
    transactions,
    categories,
    rules,
    pending,
    createTx,
    reports,
    recurrence,
    audit,
    outbound,
  );

  const baileys = new BaileysService(ingest, logger);
  baileysHolder.service = baileys;

  return { ingest, baileys, reports, transactions, users };
}
