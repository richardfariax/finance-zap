import { describe, expect, it } from 'vitest';
import { normalizeVoiceNoteText } from '../src/shared/utils/voice-transcript-normalize.js';

describe('normalizeVoiceNoteText', () => {
  it('remove aberturas comuns e normaliza espaços', () => {
    expect(normalizeVoiceNoteText('Oi, gastei 30 no mercado')).toBe('gastei 30 no mercado');
    expect(normalizeVoiceNoteText('Então, paguei 15 reais')).toBe('paguei 15 reais');
  });

  it('deduplica "reais reais"', () => {
    expect(normalizeVoiceNoteText('10 reais reais de padaria')).toBe('10 reais de padaria');
  });

  it('normaliza "r $ " para R$', () => {
    expect(normalizeVoiceNoteText('r $ 40 uber')).toContain('R$');
  });
});
