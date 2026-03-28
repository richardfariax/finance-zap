import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  parseLastTransactionCommand,
  prepareTransactionInboundSegments,
} from '../src/modules/transactions/application/last-transaction-commands.js';

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

  it('corrige valor sem exigir a palavra valor/lançamento', () => {
    const r = parseLastTransactionCommand('corrige o último para 59,90');
    expect(r.kind).toBe('UPDATE_LAST_AMOUNT');
    if (r.kind === 'UPDATE_LAST_AMOUNT') {
      expect(r.amount.equals(new Decimal('59.9'))).toBe(true);
    }
  });

  it('corrige para X sem dizer último (logo após registrar)', () => {
    const r = parseLastTransactionCommand('corrige para 12,50');
    expect(r.kind).toBe('UPDATE_LAST_AMOUNT');
    if (r.kind === 'UPDATE_LAST_AMOUNT') {
      expect(r.amount.equals(new Decimal('12.5'))).toBe(true);
    }
  });

  it('prioriza categoria quando a frase menciona categoria', () => {
    const r = parseLastTransactionCommand('corrige a última categoria para mercado');
    expect(r.kind).toBe('UPDATE_LAST_CATEGORY');
    if (r.kind === 'UPDATE_LAST_CATEGORY') {
      expect(r.categoryHint.toLowerCase()).toContain('mercado');
    }
  });

  it('pede valor quando faltam números', () => {
    expect(parseLastTransactionCommand('corrige o último').kind).toBe(
      'UPDATE_LAST_AMOUNT_NEEDS_VALUE',
    );
  });

  it('escolhe valor depois de para quando há dois números', () => {
    const r = parseLastTransactionCommand('uber 10 corrige o último para 59,90');
    expect(r.kind).toBe('UPDATE_LAST_AMOUNT');
    if (r.kind === 'UPDATE_LAST_AMOUNT') {
      expect(r.amount.equals(new Decimal('59.9'))).toBe(true);
    }
  });
});

describe('prepareTransactionInboundSegments', () => {
  it('junta correção partida por vírgula com só o valor', () => {
    expect(prepareTransactionInboundSegments('corrige o último, 59,90')).toEqual([
      'corrige o último, 59,90',
    ]);
  });

  it('junta com era + valor', () => {
    expect(prepareTransactionInboundSegments('corrige o último, era 40')).toEqual([
      'corrige o último, era 40',
    ]);
  });

  it('não junta dois lançamentos normais', () => {
    expect(prepareTransactionInboundSegments('uber 23,50, mercado 40')).toEqual([
      'uber 23,50',
      'mercado 40',
    ]);
  });
});
