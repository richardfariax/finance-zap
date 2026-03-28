import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ConfidenceLevel } from '../../../shared/types/prisma-enums.js';
import { env } from '../../../config/env.js';
import type {
  TranscriptionProvider,
  TranscriptionResult,
} from '../domain/transcription-provider.js';
import { unlinkIgnoreMissing } from '../../../shared/utils/unlink-ignore-missing.js';
import { FfmpegAudioConverter } from './ffmpeg-audio.converter.js';

export class WhisperCliTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly ffmpeg: FfmpegAudioConverter = new FfmpegAudioConverter()) {}

  async transcribe(audioPath: string, _mimeType?: string): Promise<TranscriptionResult> {
    const cli = env.WHISPER_CLI_PATH;
    const model = env.WHISPER_MODEL_PATH;
    if (!cli?.trim() || !model?.trim()) {
      return {
        text: '',
        confidence: ConfidenceLevel.LOW,
        language: env.WHISPER_LANG || 'pt',
      };
    }

    const wavPath = await this.ffmpeg.toWav16kMono(audioPath);
    const outPrefix = join(tmpdir(), `fz-whisper-${String(Date.now())}`);

    try {
      await this.runWhisper(cli, model, wavPath, outPrefix, env.WHISPER_LANG);
    } catch {
      try {
        await unlinkIgnoreMissing(wavPath);
      } catch (cleanupErr: unknown) {
        console.error('[whisper] cleanup wav após falha', cleanupErr);
      }
      return { text: '', confidence: ConfidenceLevel.LOW, language: env.WHISPER_LANG };
    }

    const txtPath = `${outPrefix}.txt`;
    let text = '';
    try {
      text = (await readFile(txtPath, 'utf8')).trim();
    } catch {
      text = '';
    } finally {
      for (const p of [txtPath, wavPath]) {
        try {
          await unlinkIgnoreMissing(p);
        } catch (cleanupErr: unknown) {
          console.error('[whisper] cleanup temp', cleanupErr);
        }
      }
    }

    const confidence =
      text.length >= 8
        ? ConfidenceLevel.MEDIUM
        : text.length > 0
          ? ConfidenceLevel.LOW
          : ConfidenceLevel.LOW;

    return { text, confidence, language: env.WHISPER_LANG };
  }

  private runWhisper(
    cli: string,
    model: string,
    wavPath: string,
    outPrefix: string,
    lang: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['-m', model, '-f', wavPath, '-otxt', '-of', outPrefix, '-l', lang];
      const prompt = env.WHISPER_PROMPT?.trim();
      if (prompt) {
        args.push('--prompt', prompt);
      }
      const p = spawn(cli, args, { stdio: 'ignore' });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`whisper CLI exited with code ${String(code ?? 'unknown')}`));
      });
    });
  }
}
