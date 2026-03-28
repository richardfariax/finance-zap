import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Idempotência', () => {
  it('schema Prisma define chave única por mensagem do provedor', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('@@unique([userId, provider, providerMessageId])');
  });
});
