import { describe, expect, it } from 'vitest';
import {
  computeNotifyAtUtc,
  parseReminderUtterance,
} from '../src/modules/reminders/application/reminder-nl-parser.js';

const TZ = 'America/Sao_Paulo';
/** 31/03/2026 12:00 em São Paulo → 15:00 UTC */
const NOW = new Date('2026-03-31T15:00:00.000Z');

describe('parseReminderUtterance', () => {
  it('interpreta consulta de agenda de hoje', () => {
    const r = parseReminderUtterance('agenda de hoje', NOW, TZ, 9, 15);
    expect(r).toEqual({ kind: 'LIST', scope: 'today' });
  });

  it('interpreta meus lembretes como próximos', () => {
    const r = parseReminderUtterance('meus lembretes', NOW, TZ, 9, 15);
    expect(r).toEqual({ kind: 'LIST', scope: 'upcoming' });
  });

  it('cria compromisso amanhã com hora', () => {
    const r = parseReminderUtterance('amanhã às 14h reunião com Ana', NOW, TZ, 9, 15);
    expect(r.kind).toBe('CREATE');
    if (r.kind === 'CREATE') {
      expect(r.title.toLowerCase()).toMatch(/reuni|ana/);
      expect(r.allDay).toBe(false);
      expect(r.recurrence).toBe('NONE');
      expect(r.earlyMinutes).toBe(15);
    }
  });

  it('cria lembrete só com dia do mês', () => {
    const r = parseReminderUtterance('dia 10 pagar aluguel', NOW, TZ, 9, 15);
    expect(r.kind).toBe('CREATE');
    if (r.kind === 'CREATE') {
      expect(r.title.toLowerCase()).toContain('aluguel');
      expect(r.allDay).toBe(true);
    }
  });

  it('cria daqui X minutos', () => {
    const r = parseReminderUtterance('daqui 30 minutos ligar para o cliente', NOW, TZ, 9, 15);
    expect(r.kind).toBe('CREATE');
    if (r.kind === 'CREATE') {
      expect(r.title.toLowerCase()).toContain('ligar');
      expect(r.recurrence).toBe('NONE');
    }
  });

  it('cancelar com hint curto após verbo', () => {
    const r = parseReminderUtterance('cancelar aluguel', NOW, TZ, 9, 15);
    expect(r).toEqual({ kind: 'CANCEL', hint: 'aluguel' });
  });

  it('não rouba frase financeira com valor', () => {
    const r = parseReminderUtterance('gastei 40 mercado', NOW, TZ, 9, 15);
    expect(r.kind).toBe('NONE');
  });

  it('não interpreta recebi + número como lembrete', () => {
    const r = parseReminderUtterance('recebi 1500 salário', NOW, TZ, 9, 15);
    expect(r.kind).toBe('NONE');
  });

  it('não confunde resumo de hoje com lembrete', () => {
    expect(parseReminderUtterance('resumo de hoje', NOW, TZ, 9, 15).kind).toBe('NONE');
    expect(parseReminderUtterance('resumo', NOW, TZ, 9, 15).kind).toBe('NONE');
    expect(parseReminderUtterance('quanto gastei hoje', NOW, TZ, 9, 15).kind).toBe('NONE');
    expect(parseReminderUtterance('gastos hoje', NOW, TZ, 9, 15).kind).toBe('NONE');
  });

  it('mantém lembrete quando o pedido é explícito (me lembra + resumo)', () => {
    const r = parseReminderUtterance('me lembra amanhã de enviar o resumo', NOW, TZ, 9, 15);
    expect(r.kind).toBe('CREATE');
  });
});

describe('computeNotifyAtUtc', () => {
  it('dia inteiro: notify no mesmo instante do evento', () => {
    const event = new Date('2026-04-10T12:00:00.000Z');
    const n = computeNotifyAtUtc(event, true, 15, NOW);
    expect(n.getTime()).toBe(event.getTime());
  });

  it('com hora: antecede earlyMinutes quando possível', () => {
    const event = new Date('2026-04-01T18:00:00.000Z');
    const n = computeNotifyAtUtc(event, false, 15, NOW);
    expect(n.getTime()).toBeLessThan(event.getTime());
  });
});
