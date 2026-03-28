export interface OutboundMessagesPort {
  sendText(toJid: string, text: string): Promise<void>;
  canSend(): boolean;
}
