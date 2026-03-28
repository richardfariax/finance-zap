import type { ConfidenceLevel } from '@prisma/client';

export interface OcrResult {
  text: string;
  confidence: ConfidenceLevel;
}

export interface OcrProvider {
  extractText(imagePath: string): Promise<OcrResult>;
}
