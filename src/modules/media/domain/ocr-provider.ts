import type { ConfidenceLevel } from '../../../shared/types/prisma-enums.js';

export interface OcrResult {
  text: string;
  confidence: ConfidenceLevel;
}

export interface OcrProvider {
  extractText(imagePath: string): Promise<OcrResult>;
}
