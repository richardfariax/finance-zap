import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((u) => u.startsWith('postgresql://') || u.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    }),
  BAILEYS_AUTH_DIR: z.string().min(1).default('./baileys_auth'),
  MEDIA_STORAGE_DIR: z.string().min(1).default('./storage/media'),
  TESSERACT_LANG: z.string().min(1).default('por+eng'),
  WHISPER_CLI_PATH: z.string().optional(),
  WHISPER_MODEL_PATH: z.string().optional(),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  DEFAULT_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
  DEFAULT_LOCALE: z.string().min(1).default('pt-BR'),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}

export const env = loadEnv();
