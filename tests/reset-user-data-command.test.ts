import { describe, expect, it } from 'vitest';
import { matchesResetUserDataCommand } from '../src/shared/utils/reset-user-data-command.js';

describe('matchesResetUserDataCommand', () => {
  it('reconhece frases de apagar dados / conta', () => {
    expect(matchesResetUserDataCommand('apagar todos os dados')).toBe(true);
    expect(matchesResetUserDataCommand('Apagar meus dados')).toBe(true);
    expect(matchesResetUserDataCommand('limpar os dados')).toBe(true);
    expect(matchesResetUserDataCommand('resetar minha conta')).toBe(true);
    expect(matchesResetUserDataCommand('zerar minha conta')).toBe(true);
    expect(matchesResetUserDataCommand('apagar tudo')).toBe(true);
  });

  it('não confunde com apagar último lançamento', () => {
    expect(matchesResetUserDataCommand('apaga o último lançamento')).toBe(false);
    expect(matchesResetUserDataCommand('apagar ultimo gasto')).toBe(false);
    expect(matchesResetUserDataCommand('apagar tudo do ultimo registro')).toBe(false);
  });

  it('rejeita texto longo ou irrelevante', () => {
    expect(matchesResetUserDataCommand('gastei 50 no mercado')).toBe(false);
    expect(matchesResetUserDataCommand('a'.repeat(200))).toBe(false);
  });
});
