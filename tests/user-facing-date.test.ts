import { describe, expect, it } from 'vitest';
import { userFacingOccurrenceLabel } from '../src/shared/utils/user-facing-date.js';

describe('userFacingOccurrenceLabel', () => {
  it('rotula Hoje quando a data cai no mesmo dia local', () => {
    const tz = 'America/Sao_Paulo';
    const now = new Date('2025-03-15T15:00:00.000Z');
    const sameDay = new Date('2025-03-15T08:00:00.000Z');
    expect(userFacingOccurrenceLabel(sameDay, now, tz)).toBe('Hoje');
  });

  it('rotula Ontem para o dia anterior no fuso', () => {
    const tz = 'America/Sao_Paulo';
    const now = new Date('2025-03-15T15:00:00.000Z');
    const yesterday = new Date('2025-03-14T12:00:00.000Z');
    expect(userFacingOccurrenceLabel(yesterday, now, tz)).toBe('Ontem');
  });

  it('usa dd/MM/yyyy para outras datas', () => {
    const tz = 'America/Sao_Paulo';
    const now = new Date('2025-03-15T15:00:00.000Z');
    const old = new Date('2025-03-01T12:00:00.000Z');
    expect(userFacingOccurrenceLabel(old, now, tz)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
