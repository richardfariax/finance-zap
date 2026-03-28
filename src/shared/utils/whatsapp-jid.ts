/**
 * Chave estável para `User.whatsappNumber` a partir do JID da conversa.
 * - `@s.whatsapp.net`: apenas dígitos do usuário (sem truncar DDI).
 * - `@lid`: prefixo `lid:` + identificador (contas sem número clássico).
 */
export function accountKeyFromWaChatJid(waChatJid: string): string {
  const [userRaw, domain = ''] = waChatJid.split('@');
  const user = (userRaw.split(':')[0] ?? '').trim();
  if (domain === 's.whatsapp.net') {
    return user.replace(/\D/g, '');
  }
  if (domain === 'lid') {
    return `lid:${user}`;
  }
  return user.replace(/\D/g, '') || waChatJid;
}

/** Para simulação HTTP quando só há número digitado. */
export function waChatJidFromDigits(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return `${d}@s.whatsapp.net`;
}
