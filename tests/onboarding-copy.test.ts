import { describe, expect, it } from 'vitest';
import {
  firstNameFromPush,
  pickDidacticTip,
} from '../src/modules/whatsapp/presentation/bot-replies.js';
import { yesterdayCalendarKeyInTz } from '../src/shared/utils/zoned-date-key.js';

describe('firstNameFromPush', () => {
  it('usa primeiro nome e capitaliza', () => {
    expect(firstNameFromPush('maria silva')).toBe('Maria');
  });

  it('fallback amigo', () => {
    expect(firstNameFromPush('')).toBe('amigo');
    expect(firstNameFromPush(null)).toBe('amigo');
  });
});

describe('pickDidacticTip', () => {
  it('retorna dicas do pool', () => {
    expect(pickDidacticTip(0).length).toBeGreaterThan(5);
    const set = new Set([0, 1, 2, 3, 4, 5].map((i) => pickDidacticTip(i)));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe('yesterdayCalendarKeyInTz', () => {
  it('ontem em São Paulo para meia-noite UTC de 28 mar', () => {
    const d = new Date('2025-03-28T03:00:00.000Z');
    const k = yesterdayCalendarKeyInTz(d, 'America/Sao_Paulo');
    expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
