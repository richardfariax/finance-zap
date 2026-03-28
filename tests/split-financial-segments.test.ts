import { describe, expect, it } from 'vitest';
import { splitFinancialSegments } from '../src/shared/utils/split-financial-segments.js';

describe('splitFinancialSegments', () => {
  it('mensagem sem vírgula retorna um único trecho', () => {
    expect(splitFinancialSegments('uber 23,50')).toEqual(['uber 23,50']);
  });

  it('separa por vírgula preservando decimal brasileiro', () => {
    expect(splitFinancialSegments('uber 23,50, mercado 40')).toEqual(['uber 23,50', 'mercado 40']);
  });

  it('preserva milhar com decimal', () => {
    expect(splitFinancialSegments('gastei 1.234,56, pix 10')).toEqual([
      'gastei 1.234,56',
      'pix 10',
    ]);
  });

  it('dois valores simples separados por vírgula', () => {
    expect(splitFinancialSegments('recebi 50, recebi 30')).toEqual(['recebi 50', 'recebi 30']);
  });
});
