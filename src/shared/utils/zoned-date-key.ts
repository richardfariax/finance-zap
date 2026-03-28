import { format, parseISO, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export function yesterdayCalendarKeyInTz(now: Date, timeZone: string): string {
  const todayLocal = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
  const y = subDays(parseISO(todayLocal), 1);
  return format(y, 'yyyy-MM-dd');
}

export function anyInstantOnCalendarDate(dateKey: string, timeZone: string): Date {
  const start = parseISO(`${dateKey}T00:00:00Z`);
  for (let h = 0; h < 48; h++) {
    const probe = new Date(start.getTime() + h * 3600_000);
    if (formatInTimeZone(probe, timeZone, 'yyyy-MM-dd') === dateKey) {
      return probe;
    }
  }
  return parseISO(`${dateKey}T12:00:00Z`);
}
