import { z } from 'zod';

export const RECEIPT_TIPOS = [
  'combustivel',
  'supermercado',
  'restaurante',
  'farmacia',
  'recibo',
  'outro',
] as const;

export type ReceiptTipo = (typeof RECEIPT_TIPOS)[number];

export const RECEIPT_CONFIANCAS = ['alta', 'media', 'baixa'] as const;
export type ReceiptConfianca = (typeof RECEIPT_CONFIANCAS)[number];

export const ReceiptItemSchema = z.object({
  nome: z.string(),
  valor: z.number(),
});

export const ReceiptInterpretationSchema = z.object({
  tipo: z.enum(['combustivel', 'supermercado', 'restaurante', 'farmacia', 'recibo', 'outro']),
  estabelecimento: z.string(),
  data: z.string(),
  valor_total: z.number(),
  itens: z.array(ReceiptItemSchema),
  categoria_sugerida: z.string(),
  observacoes: z.string(),
  confianca: z.enum(['alta', 'media', 'baixa']),
});

export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;
export type ReceiptInterpretation = z.infer<typeof ReceiptInterpretationSchema>;

export function receiptInterpretationToJson(r: ReceiptInterpretation): Record<string, unknown> {
  const v = ReceiptInterpretationSchema.parse(r);
  return { ...v } as Record<string, unknown>;
}
