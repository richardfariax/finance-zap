import type { ConfidenceLevel } from '../../../shared/types/prisma-enums.js';

export interface TranscriptionResult {
  text: string;
  confidence: ConfidenceLevel;
  language?: string;
  /** Caminho do áudio convertido (wav), se aplicável */
  convertedPath?: string;
}

export interface TranscriptionProvider {
  transcribe(audioPath: string, mimeType?: string): Promise<TranscriptionResult>;
}
