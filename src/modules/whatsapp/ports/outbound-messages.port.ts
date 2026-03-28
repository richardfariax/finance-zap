export interface OutboundMessagesPort {
  /** `toJid` deve ser o JID completo (ex.: `5511...@s.whatsapp.net`). */
  sendText(toJid: string, text: string): Promise<void>;
}
