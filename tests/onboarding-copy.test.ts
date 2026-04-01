import { describe, expect, it } from 'vitest';
import { firstNameFromPush } from '../src/modules/whatsapp/presentation/bot-replies.js';
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

describe('yesterdayCalendarKeyInTz', () => {
  it('ontem em São Paulo para meia-noite UTC de 28 mar', () => {
    const d = new Date('2025-03-28T03:00:00.000Z');
    const k = yesterdayCalendarKeyInTz(d, 'America/Sao_Paulo');
    expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
