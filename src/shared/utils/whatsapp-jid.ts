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

export function waChatJidFromDigits(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return `${d}@s.whatsapp.net`;
}
