import { Decimal } from 'decimal.js';

export type MoneyDecimal = Decimal;

export function moneyFromString(input: string): Decimal {
  return new Decimal(input);
}

export function moneyFromNumber(input: number): Decimal {
  return new Decimal(input);
}
