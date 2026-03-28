import { z } from 'zod';

export const AudioTranscriptPayloadSchema = z.object({
  transcribedText: z.string().min(1),
  audioMessageId: z.string().uuid(),
  userTimezone: z.string().min(1),
});

export type AudioTranscriptPayload = z.infer<typeof AudioTranscriptPayloadSchema>;
