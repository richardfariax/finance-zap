import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error('Missing .env.example');
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.warn('[finance-zap] Created .env from .env.example — review secrets before production.');
}
