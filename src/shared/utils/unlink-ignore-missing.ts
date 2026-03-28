import { unlink } from 'node:fs/promises';

function isEnoent(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const withCode = err as Error & { code?: unknown };
  return withCode.code === 'ENOENT';
}

export async function unlinkIgnoreMissing(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err: unknown) {
    if (isEnoent(err)) return;
    throw err;
  }
}
