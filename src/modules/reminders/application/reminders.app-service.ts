import type { ReminderSource } from '@prisma/client';
import type { Logger } from 'pino';
import { addDays, endOfDay, setHours, setMinutes, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { ReminderRepository } from '../infra/reminder.repository.js';
import {
  computeNotifyAtUtc,
  parseReminderUtterance,
  parseTimeFragment,
  type ReminderNlResult,
} from './reminder-nl-parser.js';
import * as Msg from './reminder-messages.js';

export class RemindersAppService {
  constructor(
    private readonly repo: ReminderRepository,
    private readonly defaultDayHour: number,
    private readonly defaultEarlyMinutes: number,
    private readonly log?: Logger,
  ) {}

  parseUtterance(raw: string, now: Date, tz: string): ReminderNlResult {
    return parseReminderUtterance(raw, now, tz, this.defaultDayHour, this.defaultEarlyMinutes);
  }

  async handleInbound(
    userId: string,
    raw: string,
    tz: string,
    source: ReminderSource,
    sourceMessageId: string | null,
    now: Date,
  ): Promise<{ handled: boolean; message: string }> {
    const parsed = this.parseUtterance(raw, now, tz);
    if (parsed.kind === 'NONE') {
      return { handled: false, message: '' };
    }

    try {
      switch (parsed.kind) {
        case 'CREATE': {
          const notifyAt = computeNotifyAtUtc(
            parsed.eventAtUtc,
            parsed.allDay,
            parsed.earlyMinutes,
            now,
          );
          const r = await this.repo.create({
            userId,
            title: parsed.title,
            eventAt: parsed.eventAtUtc,
            allDay: parsed.allDay,
            notifyAt,
            earlyMinutes: parsed.earlyMinutes,
            recurrence: parsed.recurrence,
            recurrenceMeta: parsed.recurrenceMeta,
            timezone: tz,
            sourceText: raw,
            source,
            sourceMessageId,
          });
          return { handled: true, message: Msg.replyReminderCreated(r, now) };
        }
        case 'LIST': {
          let items;
          if (parsed.scope === 'today') {
            const z = toZonedTime(now, tz);
            const start = fromZonedTime(startOfDay(z), tz);
            const end = fromZonedTime(endOfDay(z), tz);
            items = await this.repo.listActiveForUser(userId, {
              fromUtc: start,
              untilUtc: end,
              limit: 25,
            });
          } else if (parsed.scope === 'tomorrow') {
            const z = toZonedTime(now, tz);
            const tom = addDays(startOfDay(z), 1);
            const start = fromZonedTime(tom, tz);
            const end = fromZonedTime(endOfDay(tom), tz);
            items = await this.repo.listActiveForUser(userId, {
              fromUtc: start,
              untilUtc: end,
              limit: 25,
            });
          } else {
            const z = toZonedTime(now, tz);
            const fromUtc = fromZonedTime(startOfDay(z), tz);
            items = await this.repo.listActiveForUser(userId, { fromUtc, limit: 30 });
          }
          const title =
            parsed.scope === 'today'
              ? 'Sua agenda de hoje'
              : parsed.scope === 'tomorrow'
                ? 'Sua agenda de amanhã'
                : 'Seus próximos compromissos';
          return { handled: true, message: Msg.replyReminderList(items, title, now) };
        }
        case 'CANCEL': {
          if (parsed.hint.trim().length < 2) {
            return {
              handled: true,
              message: '⚠️ *Qual lembrete cancelar?*\n\nExemplo: cancelar lembrete do aluguel',
            };
          }
          const matches = await this.resolveMatches(userId, parsed.hint);
          if (matches.length === 0) {
            return { handled: true, message: Msg.replyReminderNotFound() };
          }
          if (matches.length > 1) {
            return { handled: true, message: Msg.replyReminderAmbiguous(matches) };
          }
          await this.repo.cancel(matches[0].id, userId);
          return { handled: true, message: Msg.replyReminderCancelled(matches[0].title) };
        }
        case 'COMPLETE': {
          const hint = parsed.hint.trim();
          if (hint.length < 2) {
            return {
              handled: true,
              message: Msg.replyReminderTeach(),
            };
          }
          const matches = await this.resolveMatches(userId, hint);
          if (matches.length === 0) {
            return { handled: true, message: Msg.replyReminderNotFound() };
          }
          if (matches.length > 1) {
            return { handled: true, message: Msg.replyReminderAmbiguous(matches) };
          }
          await this.repo.complete(matches[0].id, userId);
          return { handled: true, message: Msg.replyReminderCompleted(matches[0].title) };
        }
        case 'RESCHEDULE': {
          if (parsed.hint.trim().length < 2) {
            return {
              handled: true,
              message:
                '⚠️ *Qual compromisso remarcar?*\n\nExemplo: remarcar reunião de amanhã para 15h',
            };
          }
          const matches = await this.resolveMatches(userId, parsed.hint);
          if (matches.length !== 1) {
            if (matches.length === 0) {
              return { handled: true, message: Msg.replyReminderNotFound() };
            }
            return { handled: true, message: Msg.replyReminderAmbiguous(matches) };
          }
          const tm = parseTimeFragment(parsed.timePhrase);
          if (!tm) {
            return {
              handled: true,
              message: '⚠️ *Horário não reconhecido*\n\nExemplo: remarcar para 15h',
            };
          }
          const r = matches[0];
          const zEv = toZonedTime(r.eventAt, tz);
          const wall = setMinutes(setHours(zEv, tm.hour), tm.minute);
          const newEvent = fromZonedTime(wall, tz);
          const notifyAt = computeNotifyAtUtc(newEvent, false, r.earlyMinutes, now);
          await this.repo.updateSchedule(r.id, userId, {
            eventAt: newEvent,
            notifyAt,
            allDay: false,
          });
          const updated = await this.repo.findByIdForUser(r.id, userId);
          if (!updated) {
            return { handled: true, message: Msg.replyReminderNotFound() };
          }
          return { handled: true, message: Msg.replyReminderRescheduled(updated, now) };
        }
        default:
          return { handled: false, message: '' };
      }
    } catch (e) {
      this.log?.error({ err: e, userId }, 'reminders.handleInbound');
      return {
        handled: true,
        message: '⚠️ *Erro*\n\nNão consegui processar o lembrete. Tente novamente.',
      };
    }
  }

  private async resolveMatches(userId: string, hint: string) {
    const t = hint.trim().toLowerCase();
    if (t.length < 2) {
      return this.repo.listActiveForUser(userId, { limit: 8 });
    }
    return this.repo.searchActiveByTitle(userId, t);
  }
}
