import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { parseLastTransactionCommand } from '../src/modules/transactions/application/last-transaction-commands.js';

describe('parseLastTransactionCommand', () => {
  it('detecta apagar último lançamento', () => {
    const r = parseLastTransactionCommand('apaga o último lançamento');
    expect(r.kind).toBe('DELETE_LAST');
  });

  it('detecta correção de valor', () => {
    const r = parseLastTransactionCommand('corrige o último lançamento para 59,90');
    expect(r.kind).toBe('UPDATE_LAST_AMOUNT');
    if (r.kind === 'UPDATE_LAST_AMOUNT') {
      expect(r.amount.equals(new Decimal('59.9'))).toBe(true);
    }
  });
});
