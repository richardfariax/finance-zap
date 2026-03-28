import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';

export class MediaStorageService {
  async saveBuffer(params: { userId: string; extension: string; buffer: Buffer }): Promise<string> {
    const dir = join(env.MEDIA_STORAGE_DIR, params.userId);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${params.extension.replace(/^\./, '')}`;
    const full = join(dir, name);
    await writeFile(full, params.buffer);
    return full;
  }
}
