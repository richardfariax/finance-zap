import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '../../../config/env.js';

export class FfmpegAudioConverter {
  constructor(private readonly ffmpegPath = env.FFMPEG_PATH) {}

  async toWav16kMono(inputPath: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'finance-zap-audio-'));
    const out = join(dir, 'out.wav');
    await this.run(['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-f', 'wav', out]);
    return out;
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpegPath, args, { stdio: 'ignore' });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${String(code ?? 'unknown')}`));
      });
    });
  }
}
