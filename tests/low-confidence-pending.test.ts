import { describe, expect, it } from 'vitest';
import {
  isExplicitCancellation,
  pickCategoryIdForLowConfidenceConfirm,
} from '../src/modules/messages/application/low-confidence-pending.js';

const cats = [
  { id: 'o1', normalizedName: 'outros' },
  { id: 'a1', normalizedName: 'alimentacao' },
];

describe('low-confidence-pending', () => {
  it('sim confirma categoria sugerida', () => {
    expect(pickCategoryIdForLowConfidenceConfirm('sim', 'o1', cats)).toBe('o1');
    expect(pickCategoryIdForLowConfidenceConfirm('ok beleza', 'o1', cats)).toBe('o1');
  });

  it('nome exato de outra categoria grava essa categoria', () => {
    expect(pickCategoryIdForLowConfidenceConfirm('alimentação', 'o1', cats)).toBe('a1');
  });

  it('cancelar esvazia fluxo (detecção)', () => {
    expect(isExplicitCancellation('cancelar')).toBe(true);
    expect(isExplicitCancellation('não')).toBe(true);
    expect(isExplicitCancellation('Comprei uma pizza de 50 reais')).toBe(false);
  });
});
