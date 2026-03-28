export interface OutboundMessagesPort {
  sendText(whatsappNumberDigits: string, text: string): Promise<void>;
}
