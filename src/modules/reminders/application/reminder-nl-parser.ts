import type { ReminderRecurrence } from '@prisma/client';
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  setHours,
  setMinutes,
  startOfDay,
  isBefore,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';

export type ReminderNlResult =
  | {
      kind: 'CREATE';
      title: string;
      eventAtUtc: Date;
      allDay: boolean;
      recurrence: ReminderRecurrence;
      recurrenceMeta: Record<string, number> | null;
      earlyMinutes: number;
    }
  | { kind: 'LIST'; scope: 'today' | 'tomorrow' | 'upcoming' }
  | { kind: 'CANCEL'; hint: string }
  | { kind: 'COMPLETE'; hint: string }
  | { kind: 'RESCHEDULE'; hint: string; timePhrase: string }
  | { kind: 'NONE' };

function financeOverridesReminder(normalized: string, raw: string): boolean {
  if (/\b(gastei|recebi)\s+\d/.test(normalized)) return true;
  if (/\bpaguei\s+\d/.test(normalized)) return true;
  if (/^\s*uber\s+\d/i.test(raw.trim())) return true;
  if (/\btransferi\s+\d/.test(normalized)) return true;
  return false;
}

/**
 * Consultas de resumo, extrato e análise — o parser financeiro deve processar antes.
 * Sem isso, "resumo de hoje" virava lembrete com título "resumo de".
 */
function reportsQueriesOverrideReminder(normalized: string): boolean {
  const userWantsReminder =
    /\b(me\s+lembra|lembrete\b|lembrar(?:\s+de|\s+da|\s+do)?|agendar\b|marcar\s+reuni)\b/.test(
      normalized,
    );
  if (userWantsReminder) return false;

  if (/\bresumo\b/.test(normalized)) return true;
  if (
    /\b(quanto\s+gast(?:ei)?|o\s+que\s+gast(?:ei)?|no\s+que\s+gast(?:ei)?|em\s+que\s+gast(?:ei)?|que\s+eu\s+gast(?:ei)?|total\s+de\s+gastos)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/\b(balanco|balanço|levantamento)\b/.test(normalized)) return true;
  if (/\bextrato\b/.test(normalized)) return true;
  if (/\b(ultimos\s+lancamentos|últimos\s+lançamentos)\b/.test(normalized)) return true;
  if (
    /\b(onde\s+(?:eu\s+)?(?:mais\s+)?gast(?:ei|o)|gastei\s+mais|onde\s+gastando|maiores\s+gastos|maiores\s+despesas|top\s+gastos)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/\b(gastos\s+por\s+categoria|gastos\s+no\s+mes|gastos\s+no\s+mês)\b/.test(normalized)) {
    return true;
  }
  if (/\b(quais\s+categorias|lista\s+de\s+categorias)\b/.test(normalized)) return true;
  if (/\b(recorrentes?|gastos\s+fixos|assinaturas\s+fixas)\b/.test(normalized)) return true;
  if (
    /\b(ultima\s+transacao|última\s+transação|ultimo\s+lancamento|último\s+lançamento)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/\b(saldo\s+(?:do|da|em)|quanto\s+(?:eu\s+)?tenho)\b/.test(normalized)) return true;
  if (
    /\b(entradas?\s+(?:de\s+)?hoje|saidas?\s+(?:de\s+)?hoje|saídas?\s+(?:de\s+)?hoje)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/\b(movimentacoes|movimentações)\b/.test(normalized)) return true;
  if (/\b(fechamento|fechar\s+o\s+dia)\b/.test(normalized)) return true;
  if (/\b(ajuda|help|comandos)\b/.test(normalized)) return true;

  if (!/\d/.test(normalized)) {
    if (/\b(receitas?|entradas?)\s+(de\s+)?(hoje|ontem)\b/.test(normalized)) return true;
    if (/\b(gastos|despesas)\s+(de\s+)?(hoje|ontem|do\s+dia)\b/.test(normalized)) return true;
  }

  return false;
}

function extractHourMinute(
  text: string,
  normalized: string,
): { hour: number; minute: number; matched: boolean } | null {
  const hm = text.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})\b/i);
  if (hm) {
    const hour = Math.min(23, Math.max(0, parseInt(hm[1], 10)));
    const minute = Math.min(59, Math.max(0, parseInt(hm[2], 10)));
    return { hour, minute, matched: true };
  }
  const as = text.match(/\b(?:às|as|a)\s*(\d{1,2})\s*h\b/i);
  if (as) {
    const hour = Math.min(23, Math.max(0, parseInt(as[1], 10)));
    return { hour, minute: 0, matched: true };
  }
  const hx = normalized.match(/\b(\d{1,2})\s*h\b/);
  if (hx) {
    const hour = Math.min(23, Math.max(0, parseInt(hx[1], 10)));
    return { hour, minute: 0, matched: true };
  }
  return null;
}

function weekdayJsFromPt(n: string): number | null {
  if (/\bdomingo\b/.test(n)) return 0;
  if (/\bsegunda\b/.test(n)) return 1;
  if (/\bterca\b/.test(n) || /\bterça\b/.test(n)) return 2;
  if (/\bquarta\b/.test(n)) return 3;
  if (/\bquinta\b/.test(n)) return 4;
  if (/\bsexta\b/.test(n)) return 5;
  if (/\bsabado\b/.test(n) || /\bsábado\b/.test(n)) return 6;
  return null;
}

function zonedWallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  return fromZonedTime(new Date(y, mo - 1, d, h, mi, 0, 0), tz);
}

function nextWeekdayUtc(
  now: Date,
  targetDow: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const z = toZonedTime(now, tz);
  let cur = startOfDay(z);
  const todayDow = cur.getDay();
  let add = (targetDow - todayDow + 7) % 7;
  if (add === 0) {
    const withTime = setMinutes(setHours(cur, hour), minute);
    if (!isBefore(now, fromZonedTime(withTime, tz))) add = 7;
  }
  cur = addDays(cur, add);
  const wall = setMinutes(setHours(cur, hour), minute);
  return fromZonedTime(wall, tz);
}

function stripCreatePrefixes(title: string): string {
  const t = title
    .replace(/^\s*me\s+lembra(?:\s+de|\s+da|\s+do|\s+a|\s+o)?\s+/iu, '')
    .replace(/^\s*lembr(?:ar|a)(?:\s+de|\s+da|\s+do)?\s+/iu, '')
    .replace(/^\s*lembrete\s*[:-]?\s*/iu, '')
    .replace(/^\s*agendar\s+/iu, '')
    .replace(/^\s*marcar\s+/iu, '')
    .trim();
  return t || title.trim();
}

function stripTemporalFragments(t: string, _n: string): string {
  let out = stripCreatePrefixes(t);
  out = out.replace(/\bdaqui\s+\d+\s*(?:min(?:uto)?s?|horas?|h)\b/giu, '');
  out = out.replace(/\bamanh[ãa]\b/giu, '');
  out = out.replace(/\bhoje\b/giu, '');
  out = out.replace(/\bdepois\s+de\s+amanh[ãa]\b/giu, '');
  out = out.replace(
    /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:[-\s]feira)?\b/giu,
    '',
  );
  out = out.replace(/\bdia\s+\d{1,2}\b/giu, '');
  out = out.replace(/\b(?:às|as|a)\s*\d{1,2}\s*h\b/giu, '');
  out = out.replace(/\b\d{1,2}\s*[:h]\s*\d{2}\b/g, '');
  out = out.replace(/\b\d{1,2}\s*h\b/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length >= 2 ? out : t.trim();
}

function parseListScope(n: string): ReminderNlResult | null {
  if (/\b(meus\s+)?lembretes\b/.test(n) && !/\b(cancelar|apagar|remover|criar|marcar)\b/.test(n)) {
    if (/\b(amanha|amanhã)\b/.test(n)) return { kind: 'LIST', scope: 'tomorrow' };
    if (/\bhoje\b/.test(n)) return { kind: 'LIST', scope: 'today' };
    return { kind: 'LIST', scope: 'upcoming' };
  }
  if (/\bagenda\b/.test(n)) {
    if (/\b(amanha|amanhã)\b/.test(n)) return { kind: 'LIST', scope: 'tomorrow' };
    if (/\bhoje\b/.test(n)) return { kind: 'LIST', scope: 'today' };
    return { kind: 'LIST', scope: 'upcoming' };
  }
  if (/\b(proximos|próximos)\s+compromissos\b/.test(n)) return { kind: 'LIST', scope: 'upcoming' };
  if (/\bo\s+que\s+tenho\s+hoje\b/.test(n)) return { kind: 'LIST', scope: 'today' };
  if (/\bcompromissos\s+de\s+hoje\b/.test(n)) return { kind: 'LIST', scope: 'today' };
  if (/\bquais\s+lembretes\b/.test(n)) return { kind: 'LIST', scope: 'upcoming' };
  return null;
}

function parseCancel(n: string, raw: string): ReminderNlResult | null {
  if (!/\b(cancelar|cancela|apagar|apaga|remover|remove)\b/.test(n)) return null;
  const hint = raw
    .replace(/\b(cancelar|cancela|apagar|apaga|remover|remove)\b/giu, '')
    .replace(/\b(o|a|os|as)\s+lembrete\s+(do|da|de)\b/giu, '')
    .replace(/\b(lembrete|compromisso|reuni[aã]o)\s+(do|da|de)\b/giu, '')
    .replace(/\b(lembrete|compromisso)\b/giu, '')
    .trim();
  if (hint.length < 2) return null;
  const hasNoun =
    /\b(lembrete|compromisso|reuni|agenda|tarefa)\b/.test(n) || /\b(do|da|de)\s+\w+/i.test(raw);
  if (!hasNoun && hint.length < 4) return null;
  return { kind: 'CANCEL', hint: hint.slice(0, 120) };
}

function parseComplete(n: string, raw: string): ReminderNlResult | null {
  if (
    /\b(marcar\s+como\s+feito|tarefa\s+conclu[ií]da|conclu[ií]\s*o\s+lembrete)\b/.test(n) ||
    /^conclu[ií]\s*$/u.test(n.trim())
  ) {
    const hint = raw.replace(/\b(marcar\s+como\s+feito|tarefa\s+conclu[ií]da)\b/giu, '').trim();
    return { kind: 'COMPLETE', hint: hint.slice(0, 120) };
  }
  if (/\bpaguei\s+a\s+conta\b/.test(n) || /\bfeito\s+o\b/.test(n)) {
    return { kind: 'COMPLETE', hint: raw.slice(0, 120) };
  }
  return null;
}

function parseReschedule(n: string, raw: string): ReminderNlResult | null {
  if (!/\b(remarcar|mudar|alterar)\b/.test(n)) return null;
  if (!/\b(lembrete|compromisso|hor[aá]rio|reuni(ao|ão))\b/.test(n)) return null;
  const para = raw.match(/\bpara\s+(.+)$/iu);
  const timePhrase = para ? para[1].trim() : '';
  if (!timePhrase) return null;
  const hint =
    raw
      .replace(/\b(remarcar|mudar|alterar)\b/giu, '')
      .replace(/\b(lembrete|compromisso|hor[aá]rio)\b/giu, '')
      .split(/\bpara\b/i)[0]
      ?.trim() ?? '';
  return { kind: 'RESCHEDULE', hint: hint.slice(0, 80), timePhrase };
}

/**
 * Interpreta texto livre para comandos de agenda / lembretes (pt-BR).
 */
export function parseReminderUtterance(
  rawInput: string,
  nowUtc: Date,
  userTz: string,
  defaultDayHour: number,
  defaultEarlyMinutes: number,
): ReminderNlResult {
  const raw = rawInput.replace(/\s+/g, ' ').trim();
  if (raw.length < 2) return { kind: 'NONE' };
  const n = normalizeForMatch(raw);

  if (financeOverridesReminder(n, raw)) return { kind: 'NONE' };
  if (reportsQueriesOverrideReminder(n)) return { kind: 'NONE' };

  const list = parseListScope(n);
  if (list) return list;

  const cancel = parseCancel(n, raw);
  if (cancel) return cancel;

  const comp = parseComplete(n, raw);
  if (comp) return comp;

  const resched = parseReschedule(n, raw);
  if (resched?.kind === 'RESCHEDULE' && resched.timePhrase.length > 1) return resched;

  const hasTimeCue =
    /\b(amanha|amanhã|hoje|depois\s+de\s+amanh[ãa]|daqui|dia\s+\d{1,2}|todo\s+dia|todo\s+mes|todo\s+mês|toda\s+semana)\b/.test(
      n,
    ) ||
    weekdayJsFromPt(n) !== null ||
    /\b(\d{1,2})\s*[:h]\s*\d{2}\b/.test(raw) ||
    /\b(?:às|as)\s*\d{1,2}/i.test(raw);

  const hasReminderCue =
    /\b(me\s+lembra|lembrete|lembrar|compromisso|agendar|marcar\s+reuni)\b/.test(n) ||
    /\bpagar\b/.test(n);

  if (!hasTimeCue && !hasReminderCue) return { kind: 'NONE' };

  const hm = extractHourMinute(raw, n);
  const zNow = toZonedTime(nowUtc, userTz);
  const todaSemana = /\btoda\s+semana\b/.test(n) && weekdayJsFromPt(n) !== null;

  // --- Recorrência simples ---
  const todoDia = /\btodo\s+dia\b/.test(n);

  if (todoDia && hm) {
    const hour = hm.hour;
    const minute = hm.minute;
    let z = startOfDay(zNow);
    let wall = setMinutes(setHours(z, hour), minute);
    let eventUtc = fromZonedTime(wall, userTz);
    if (!isBefore(nowUtc, eventUtc)) {
      z = addDays(z, 1);
      wall = setMinutes(setHours(z, hour), minute);
      eventUtc = fromZonedTime(wall, userTz);
    }
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay: false,
      recurrence: 'DAILY',
      recurrenceMeta: { hourLocal: hour, minuteLocal: minute },
      earlyMinutes: defaultEarlyMinutes,
    };
  }

  const mesM = n.match(/\btodo\s+m[eê]s\s+dia\s+(\d{1,2})\b/);
  if (mesM) {
    const dom = Math.min(28, Math.max(1, parseInt(mesM[1], 10)));
    let y = zNow.getFullYear();
    let mo = zNow.getMonth() + 1;
    let wall = zonedWallToUtc(y, mo, dom, defaultDayHour, 0, userTz);
    if (!isBefore(nowUtc, wall)) {
      const next = addMonths(new Date(y, mo - 1, 1), 1);
      y = next.getFullYear();
      mo = next.getMonth() + 1;
      wall = zonedWallToUtc(y, mo, dom, defaultDayHour, 0, userTz);
    }
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: wall,
      allDay: true,
      recurrence: 'MONTHLY',
      recurrenceMeta: { dayOfMonth: dom, hourLocal: defaultDayHour, minuteLocal: 0 },
      earlyMinutes: 0,
    };
  }

  // daqui X minutos / horas
  const rel = n.match(/\bdaqui\s+(\d+)\s*(min|minutos|hora|horas|h)\b/);
  if (rel) {
    const num = parseInt(rel[1], 10);
    const unit = rel[2];
    const add =
      unit.startsWith('hor') || unit === 'h' ? addHours(nowUtc, num) : addMinutes(nowUtc, num);
    const eventUtc = add;
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay: false,
      recurrence: 'NONE',
      recurrenceMeta: null,
      earlyMinutes: defaultEarlyMinutes,
    };
  }

  // Hoje / amanhã / depois de amanhã + hora opcional
  let dayOffset: number | null = null;
  if (/\bhoje\b/.test(n)) dayOffset = 0;
  else if (/\bamanha\b/.test(n) || /\bamanhã\b/.test(n)) dayOffset = 1;
  else if (/\bdepois\s+de\s+amanh[ãa]\b/.test(n)) dayOffset = 2;

  if (dayOffset !== null) {
    const zDay = addDays(startOfDay(zNow), dayOffset);
    let eventUtc: Date;
    let allDay = true;
    if (hm) {
      allDay = false;
      const wall = setMinutes(setHours(zDay, hm.hour), hm.minute);
      eventUtc = fromZonedTime(wall, userTz);
    } else {
      eventUtc = fromZonedTime(setMinutes(setHours(zDay, defaultDayHour), 0), userTz);
    }
    const early = allDay ? 0 : defaultEarlyMinutes;
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay,
      recurrence: 'NONE',
      recurrenceMeta: null,
      earlyMinutes: early,
    };
  }

  // Dia N (do mês)
  const diaM = n.match(/\bdia\s+(\d{1,2})\b/);
  if (diaM && !weekdayJsFromPt(n)) {
    const dom = Math.min(31, Math.max(1, parseInt(diaM[1], 10)));
    let y = zNow.getFullYear();
    let mo = zNow.getMonth() + 1;
    const withHm = hm;
    const h = withHm ? withHm.hour : defaultDayHour;
    const mi = withHm ? withHm.minute : 0;
    let eventUtc = zonedWallToUtc(y, mo, dom, h, mi, userTz);
    if (!isBefore(nowUtc, eventUtc)) {
      const next = addMonths(new Date(y, mo - 1, 1), 1);
      y = next.getFullYear();
      mo = next.getMonth() + 1;
      eventUtc = zonedWallToUtc(y, mo, dom, h, mi, userTz);
    }
    const allDay = !withHm;
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay,
      recurrence: 'NONE',
      recurrenceMeta: null,
      earlyMinutes: allDay ? 0 : defaultEarlyMinutes,
    };
  }

  // Próximo dia da semana (ex.: sexta)
  const wd = weekdayJsFromPt(n);
  if (wd !== null && hm) {
    const eventUtc = nextWeekdayUtc(nowUtc, wd, hm.hour, hm.minute, userTz);
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay: false,
      recurrence: todaSemana ? 'WEEKLY' : 'NONE',
      recurrenceMeta: todaSemana
        ? { weekday: wd, hourLocal: hm.hour, minuteLocal: hm.minute }
        : null,
      earlyMinutes: defaultEarlyMinutes,
    };
  }

  if (wd !== null && !hm) {
    const eventUtc = nextWeekdayUtc(nowUtc, wd, defaultDayHour, 0, userTz);
    const title = stripTemporalFragments(raw, n);
    if (title.length < 2) return { kind: 'NONE' };
    return {
      kind: 'CREATE',
      title,
      eventAtUtc: eventUtc,
      allDay: true,
      recurrence: 'NONE',
      recurrenceMeta: null,
      earlyMinutes: 0,
    };
  }

  return { kind: 'NONE' };
}

/** Calcula notifyAt em UTC a partir do evento e regras. */
export function computeNotifyAtUtc(
  eventAtUtc: Date,
  allDay: boolean,
  earlyMinutes: number,
  nowUtc: Date,
): Date {
  if (allDay) {
    return eventAtUtc;
  }
  const n = addMinutes(eventAtUtc, -earlyMinutes);
  return isBefore(n, nowUtc) ? addMinutes(nowUtc, 1) : n;
}

export function parseTimeFragment(text: string): { hour: number; minute: number } | null {
  const t = extractHourMinute(text, normalizeForMatch(text));
  if (!t?.matched) return null;
  return { hour: t.hour, minute: t.minute };
}
