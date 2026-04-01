import { formatInTimeZone } from 'date-fns-tz';
import { yesterdayCalendarKeyInTz } from './zoned-date-key.js';

/**
 * Rótulo curto para data de lançamento (fuso do usuário): Hoje, Ontem ou dd/MM/yyyy.
 */
export function userFacingOccurrenceLabel(occurredAt: Date, now: Date, timeZone: string): string {
  const occ = formatInTimeZone(occurredAt, timeZone, 'yyyy-MM-dd');
  const today = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
  if (occ === today) return 'Hoje';
  const yesterdayKey = yesterdayCalendarKeyInTz(now, timeZone);
  if (occ === yesterdayKey) return 'Ontem';
  return formatInTimeZone(occurredAt, timeZone, 'dd/MM/yyyy');
}
