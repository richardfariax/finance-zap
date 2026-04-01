import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { ConfidenceLevel } from '../../../shared/types/prisma-enums.js';
import { env } from '../../../config/env.js';
import type { OcrProvider, OcrResult } from '../domain/ocr-provider.js';

export class TesseractOcrProvider implements OcrProvider {
  async extractText(imagePath: string): Promise<OcrResult> {
    const buffer = await sharp(imagePath).greyscale().normalize().sharpen().png().toBuffer();

    const worker = await createWorker(env.TESSERACT_LANG);
    const {
      data: { text, confidence },
    } = await worker.recognize(buffer);
    await worker.terminate();

    const trimmed = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
    const conf =
      confidence >= 70
        ? ConfidenceLevel.HIGH
        : confidence >= 45
          ? ConfidenceLevel.MEDIUM
          : ConfidenceLevel.LOW;

    return { text: trimmed, confidence: conf };
  }
}
