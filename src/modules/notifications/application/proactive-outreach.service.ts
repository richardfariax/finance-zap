import { formatInTimeZone } from 'date-fns-tz';
import type { Logger } from 'pino';
import type { ReportsService } from '../../reports/application/reports.service.js';
import type { UserRepository } from '../../users/infra/user.repository.js';
import type { OutboundMessagesPort } from '../../whatsapp/ports/outbound-messages.port.js';
import {
  replyAutomatedDaySummary,
  replyPinConversationNudge,
} from '../../whatsapp/presentation/bot-replies.js';
import {
  anyInstantOnCalendarDate,
  yesterdayCalendarKeyInTz,
} from '../../../shared/utils/zoned-date-key.js';

const TICK_MS = 60_000;
const MS_DAY = 24 * 60 * 60 * 1000;

export class ProactiveOutreachService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly users: UserRepository,
    private readonly reports: ReportsService,
    private readonly outbound: OutboundMessagesPort,
    private readonly log?: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    const onTickError = (err: unknown): void => {
      if (this.log) this.log.error({ err }, 'proactive-outreach tick');
      else console.error('[proactive-outreach]', err);
    };
    this.timer = setInterval(() => {
      void this.tick().catch(onTickError);
    }, TICK_MS);
    void this.tick().catch(onTickError);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.outbound.canSend()) {
      return;
    }

    const now = new Date();
    const list = await this.users.listForProactiveOutreach();

    for (const u of list) {
      const jid = u.waChatJid;
      if (!jid || !u.lastInboundAt) continue;

      await this.maybeSendDailySummary(u.id, u.timezone, jid, u.lastDailySummaryForDate, now);
      await this.maybeSendPinNudge(u.id, jid, u.lastInboundAt, u.lastPinNudgeAt, now);
    }
  }

  private async maybeSendDailySummary(
    userId: string,
    timeZone: string,
    jid: string,
    lastSentFor: string | null,
    now: Date,
  ): Promise<void> {
    const hour = Number(formatInTimeZone(now, timeZone, 'H'));
    const minute = Number(formatInTimeZone(now, timeZone, 'm'));
    if (hour !== 0 || minute >= 45) return;

    const yesterdayKey = yesterdayCalendarKeyInTz(now, timeZone);
    if (lastSentFor === yesterdayKey) return;

    try {
      const ref = anyInstantOnCalendarDate(yesterdayKey, timeZone);
      const day = await this.reports.dailySummary(userId, timeZone, ref);
      const cats = await this.reports.categoryBreakdownToday(userId, timeZone, ref);
      const text = replyAutomatedDaySummary(day, cats);
      await this.outbound.sendText(jid, text);
      await this.users.setLastDailySummaryForDate(userId, yesterdayKey);
    } catch (err) {
      if (this.log) this.log.warn({ err, userId }, 'Falha no resumo automático diário');
    }
  }

  private async maybeSendPinNudge(
    userId: string,
    jid: string,
    lastInboundAt: Date,
    lastPinNudgeAt: Date | null,
    now: Date,
  ): Promise<void> {
    const silentMs = now.getTime() - lastInboundAt.getTime();
    if (silentMs < MS_DAY) return;

    const eligible = lastPinNudgeAt === null || lastPinNudgeAt.getTime() < lastInboundAt.getTime();
    if (!eligible) return;

    try {
      await this.outbound.sendText(jid, replyPinConversationNudge());
      await this.users.setLastPinNudgeAt(userId, now);
    } catch (err) {
      if (this.log) this.log.warn({ err, userId }, 'Falha no lembrete de fixar conversa');
    }
  }
}
