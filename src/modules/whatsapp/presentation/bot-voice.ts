/**
 * Identidade visual das mensagens: títulos curtos com emoji + negrito.
 * Sem dicas automáticas (💡) — o conteúdo deve bastar.
 */
export const FZ_TAGLINE = 'Controle financeiro e compromissos pelo WhatsApp.';

export function fzSection(emoji: string, title: string): string {
  return `${emoji} *${title}*`;
}
