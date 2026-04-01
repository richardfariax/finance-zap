import type { UserReminder } from '@prisma/client';
import { format, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { fzSection } from '../../whatsapp/presentation/bot-voice.js';

function calendarLine(eventAt: Date, _allDay: boolean, tz: string, nowUtc: Date): string {
  const zEv = toZonedTime(eventAt, tz);
  const zNow = toZonedTime(nowUtc, tz);
  const zTom = new Date(zNow);
  zTom.setDate(zTom.getDate() + 1);

  if (isSameDay(zEv, zNow)) return '🗓️ Hoje';
  if (isSameDay(zEv, zTom)) return '🗓️ Amanhã';

  const d = zEv.getDate();
  const months = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `🗓️ Dia ${String(d)} ${months[zEv.getMonth()] ?? ''}`.trim();
}

function timeLine(eventAt: Date, allDay: boolean, tz: string): string | null {
  if (allDay) return null;
  const z = toZonedTime(eventAt, tz);
  return `⏰ ${format(z, 'HH:mm')}`;
}

export function replyReminderCreated(r: UserReminder, nowUtc: Date): string {
  const cal = calendarLine(r.eventAt, r.allDay, r.timezone, nowUtc);
  const tm = timeLine(r.eventAt, r.allDay, r.timezone);
  const lines = ['✅ *Lembrete criado*', '', `📌 ${r.title}`, cal];
  if (tm) lines.push(tm);
  if (r.recurrence !== 'NONE') {
    lines.push(`🔁 ${recurrenceLabel(r)}`);
  }
  lines.push('');
  if (!r.allDay && r.earlyMinutes > 0) {
    lines.push(`Vou te lembrar ${r.earlyMinutes} minutos antes.`);
  } else if (r.allDay) {
    lines.push('Vou te lembrar no dia combinado.');
  } else {
    lines.push('Vou te lembrar no horário combinado.');
  }
  return lines.join('\n');
}

function recurrenceLabel(r: UserReminder): string {
  switch (r.recurrence) {
    case 'DAILY':
      return 'Todo dia';
    case 'WEEKLY':
      return 'Toda semana';
    case 'MONTHLY':
      return 'Todo mês';
    default:
      return '';
  }
}

export function replyReminderFired(r: UserReminder, isEarly: boolean, nowUtc: Date): string {
  const cal = calendarLine(r.eventAt, r.allDay, r.timezone, nowUtc);
  const tm = timeLine(r.eventAt, r.allDay, r.timezone);
  const lines = [fzSection('⏰', 'Lembrete'), '', `📌 ${r.title}`];
  lines.push(cal);
  if (tm) lines.push(tm);
  lines.push('');
  lines.push(isEarly ? `Faltam ${r.earlyMinutes} minutos.` : 'É agora.');
  return lines.join('\n');
}

export function replyReminderList(items: UserReminder[], title: string, nowUtc: Date): string {
  if (items.length === 0) {
    return [fzSection('📅', title), '', 'Nenhum compromisso neste período.'].join('\n');
  }
  const lines = [fzSection('📅', title), ''];
  items.forEach((r, i) => {
    const cal = calendarLine(r.eventAt, r.allDay, r.timezone, nowUtc);
    const tm = timeLine(r.eventAt, r.allDay, r.timezone);
    lines.push(`${String(i + 1)}. ${r.title}`);
    lines.push(cal);
    if (tm) lines.push(tm);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

export function replyReminderCancelled(title: string): string {
  return ['✅ *Cancelado*', '', `📌 ${title}`].join('\n');
}

export function replyReminderCompleted(title: string): string {
  return ['✅ *Concluído*', '', `📌 ${title}`].join('\n');
}

export function replyReminderNotFound(): string {
  return [fzSection('⚠️', 'Não encontrei'), 'Nenhum lembrete ativo com esse nome.'].join('\n');
}

export function replyReminderAmbiguous(matches: UserReminder[]): string {
  const lines = [
    fzSection('⚠️', 'Qual destes?'),
    '',
    ...matches.slice(0, 5).map((r, i) => `${String(i + 1)}. ${r.title}`),
    '',
    'Responda com o número ou o nome completo.',
  ];
  return lines.join('\n');
}

export function replyReminderRescheduled(r: UserReminder, nowUtc: Date): string {
  return [
    '✅ *Horário atualizado*',
    '',
    `📌 ${r.title}`,
    calendarLine(r.eventAt, r.allDay, r.timezone, nowUtc),
    timeLine(r.eventAt, r.allDay, r.timezone) ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function replyReminderTeach(): string {
  return [
    fzSection('📅', 'Agenda e lembretes'),
    'Exemplos:',
    '',
    '• amanhã às 14h reunião com Ana',
    '• me lembra daqui 30 minutos de ligar para o cliente',
    '• dia 10 pagar aluguel',
    '• sexta pagar internet',
    '',
    'Consultar:',
    '',
    '• agenda',
    '• agenda de hoje',
    '',
    'Cancelar:',
    '',
    '• cancelar lembrete do aluguel',
  ].join('\n');
}
