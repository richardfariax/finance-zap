export function normalizeWhatsAppNumber(jidUser: string): string {
  const digits = jidUser.replace(/\D/g, '');
  return digits;
}
