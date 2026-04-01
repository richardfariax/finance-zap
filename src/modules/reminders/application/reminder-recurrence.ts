import type { UserReminder } from '@prisma/client';
import { addDays, addMonths, setHours, setMinutes, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { computeNotifyAtUtc } from './reminder-nl-parser.js';

type Meta = { hourLocal?: number; minuteLocal?: number; dayOfMonth?: number; weekday?: number };

/**
 * Próxima ocorrência após a última `eventAt` gravada (para lembretes recorrentes).
 */
export function nextReminderSchedule(
  reminder: UserReminder,
  nowUtc: Date,
): { eventAtUtc: Date; notifyAtUtc: Date } | null {
  const tz = reminder.timezone;
  const meta = (reminder.recurrenceMeta as Meta | null) ?? {};
  const anchor = reminder.eventAt;

  switch (reminder.recurrence) {
    case 'NONE':
      return null;
    case 'DAILY': {
      const z = toZonedTime(anchor, tz);
      const base = addDays(startOfDay(z), 1);
      const h = meta.hourLocal ?? 8;
      const mi = meta.minuteLocal ?? 0;
      const wall = setMinutes(setHours(base, h), mi);
      const eventAtUtc = fromZonedTime(wall, tz);
      const notifyAtUtc = computeNotifyAtUtc(eventAtUtc, false, reminder.earlyMinutes, nowUtc);
      return { eventAtUtc, notifyAtUtc };
    }
    case 'WEEKLY': {
      const eventAtUtc = addDays(anchor, 7);
      const notifyAtUtc = computeNotifyAtUtc(
        eventAtUtc,
        reminder.allDay,
        reminder.allDay ? 0 : reminder.earlyMinutes,
        nowUtc,
      );
      return { eventAtUtc, notifyAtUtc };
    }
    case 'MONTHLY': {
      const dom = meta.dayOfMonth ?? toZonedTime(anchor, tz).getDate();
      const z = toZonedTime(anchor, tz);
      let y = z.getFullYear();
      let mo = z.getMonth() + 1;
      const h = meta.hourLocal ?? 9;
      const mi = meta.minuteLocal ?? 0;
      const nextMonth = addMonths(new Date(y, mo - 1, 1), 1);
      y = nextMonth.getFullYear();
      mo = nextMonth.getMonth() + 1;
      const eventAtUtc = fromZonedTime(new Date(y, mo - 1, dom, h, mi, 0, 0), tz);
      const notifyAtUtc = computeNotifyAtUtc(eventAtUtc, reminder.allDay, 0, nowUtc);
      return { eventAtUtc, notifyAtUtc };
    }
    default:
      return null;
  }
}
