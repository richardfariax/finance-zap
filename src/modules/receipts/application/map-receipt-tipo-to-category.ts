import type { ReceiptTipo } from '../domain/receipt-interpretation.js';

export function appCategoryNameFromReceiptTipo(tipo: ReceiptTipo): string {
  switch (tipo) {
    case 'combustivel':
      return 'Transporte';
    case 'supermercado':
      return 'Mercado';
    case 'restaurante':
      return 'Alimentação';
    case 'farmacia':
      return 'Saúde';
    case 'recibo':
    case 'outro':
    default:
      return 'Outros';
  }
}
