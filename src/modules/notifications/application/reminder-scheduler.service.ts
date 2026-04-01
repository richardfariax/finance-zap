import type { Logger } from 'pino';
import { subMinutes } from 'date-fns';
import type { UserReminder } from '@prisma/client';
import type { OutboundMessagesPort } from '../../whatsapp/ports/outbound-messages.port.js';
import type { UserRepository } from '../../users/infra/user.repository.js';
import type { ReminderRepository } from '../../reminders/infra/reminder.repository.js';
import { nextReminderSchedule } from '../../reminders/application/reminder-recurrence.js';
import { replyReminderFired } from '../../reminders/application/reminder-messages.js';

const TICK_MS = 60_000;
const LOOKBACK_MINUTES = 180;

export class ReminderSchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly users: UserRepository,
    private readonly reminders: ReminderRepository,
    private readonly outbound: OutboundMessagesPort,
    private readonly log?: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.tick().catch((err: unknown) => {
        if (this.log) this.log.error({ err }, 'reminder-scheduler tick');
        else console.error('[reminder-scheduler]', err);
      });
    };
    this.timer = setInterval(run, TICK_MS);
    run();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Para testes e rota /dev. */
  async tickOnce(): Promise<number> {
    return this.tick();
  }

  private async tick(): Promise<number> {
    if (!this.outbound.canSend()) {
      return 0;
    }
    const now = new Date();
    const windowStart = subMinutes(now, LOOKBACK_MINUTES);
    const due = await this.reminders.findDue(now, windowStart, 100);
    let sent = 0;

    for (const r of due) {
      const ok = await this.processDueReminder(r, now);
      if (ok) sent += 1;
    }
    return sent;
  }

  private async processDueReminder(r: UserReminder, now: Date): Promise<boolean> {
    const user = await this.users.getById(r.userId);
    const jid = user?.waChatJid;
    if (!jid?.trim()) {
      return false;
    }

    const claimed = await this.reminders.tryClaimDeliverySlot(r.id, r.notifyAt);
    if (!claimed) {
      return false;
    }

    const isEarly = !r.allDay && r.earlyMinutes > 0 && r.notifyAt.getTime() < r.eventAt.getTime();
    const text = replyReminderFired(r, isEarly, now);

    try {
      await this.outbound.sendText(jid, text);
    } catch (err) {
      if (this.log) {
        this.log.error({ err, reminderId: r.id }, 'Falha ao enviar lembrete WhatsApp');
      }
      return false;
    }

    const next = nextReminderSchedule(r, now);
    if (!next) {
      await this.reminders.updateAfterDelivery(r.id, {
        status: 'COMPLETED',
        completedAt: now,
      });
    } else {
      await this.reminders.updateAfterDelivery(r.id, {
        eventAt: next.eventAtUtc,
        notifyAt: next.notifyAtUtc,
      });
    }
    return true;
  }
}
