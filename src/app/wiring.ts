import type { OutboundMessagesPort } from '../modules/whatsapp/ports/outbound-messages.port.js';
import { BaileysService } from '../modules/whatsapp/infra/baileys.service.js';
import { AuditService } from '../modules/audit/application/audit.service.js';
import { CategoryRepository } from '../modules/categories/infra/category.repository.js';
import { PendingConfirmationRepository } from '../modules/confirmations/infra/pending-confirmation.repository.js';
import { IngestInboundUseCase } from '../modules/messages/application/ingest-inbound.use-case.js';
import { ProactiveOutreachService } from '../modules/notifications/application/proactive-outreach.service.js';
import { ReminderSchedulerService } from '../modules/notifications/application/reminder-scheduler.service.js';
import { ReminderRepository } from '../modules/reminders/infra/reminder.repository.js';
import { RemindersAppService } from '../modules/reminders/application/reminders.app-service.js';
import { MessageRepository } from '../modules/messages/infra/message.repository.js';
import { RecurrenceDetectorService } from '../modules/recurrence/application/recurrence-detector.service.js';
import { ReportsService } from '../modules/reports/application/reports.service.js';
import { RuleRepository } from '../modules/rules/infra/rule.repository.js';
import { CreateTransactionUseCase } from '../modules/transactions/application/create-transaction.use-case.js';
import { TransactionRepository } from '../modules/transactions/infra/transaction.repository.js';
import { EnsureUserUseCase } from '../modules/users/application/ensure-user.use-case.js';
import { UserRepository } from '../modules/users/infra/user.repository.js';
import type { Logger } from 'pino';
import { env } from '../config/env.js';

export interface AppWiring {
  ingest: IngestInboundUseCase;
  baileys: BaileysService;
  reports: ReportsService;
  transactions: TransactionRepository;
  users: UserRepository;
  proactive: ProactiveOutreachService;
  reminders: RemindersAppService;
  reminderScheduler: ReminderSchedulerService;
  reminderRepository: ReminderRepository;
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
  const createTx = new CreateTransactionUseCase(transactions, audit, recurrence, logger);

  const baileysHolder: { service: BaileysService | null } = { service: null };

  const outbound: OutboundMessagesPort = {
    canSend(): boolean {
      return baileysHolder.service?.isSendReady() ?? false;
    },
    async sendText(toJid: string, text: string): Promise<void> {
      const svc = baileysHolder.service;
      if (!svc) {
        throw new Error('WhatsApp ainda não inicializado');
      }
      await svc.sendText(toJid, text);
    },
  };

  const proactive = new ProactiveOutreachService(users, reports, outbound, logger);

  const reminderRepository = new ReminderRepository();
  const reminders = new RemindersAppService(
    reminderRepository,
    env.REMINDER_DEFAULT_DAY_HOUR,
    env.REMINDER_EARLY_MINUTES,
    logger,
  );
  const reminderScheduler = new ReminderSchedulerService(
    users,
    reminderRepository,
    outbound,
    logger,
  );

  const ingest = new IngestInboundUseCase(
    ensureUser,
    users,
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
    reminders,
    logger,
  );

  const baileys = new BaileysService(ingest, logger);
  baileysHolder.service = baileys;

  return {
    ingest,
    baileys,
    reports,
    transactions,
    users,
    proactive,
    reminders,
    reminderScheduler,
    reminderRepository,
  };
}
