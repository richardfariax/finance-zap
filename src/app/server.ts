import { mkdir } from 'node:fs/promises';
import pino from 'pino';
import { env } from '../config/env.js';
import { buildHttpApp } from './app.js';
import { buildWiring } from './wiring.js';

function shutdown(signals: NodeJS.Signals): void {
  const logger = pino({ level: env.LOG_LEVEL });
  logger.info({ signals }, 'Encerrando aplicação');
  process.exit(0);
}

async function main(): Promise<void> {
  await mkdir(env.MEDIA_STORAGE_DIR, { recursive: true });

  const logger = pino({
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          }
        : undefined,
  });

  const wiring = buildWiring(logger);
  const app = await buildHttpApp(wiring);

  if (!env.WHISPER_CLI_PATH?.trim() || !env.WHISPER_MODEL_PATH?.trim()) {
    logger.warn(
      'Áudio: configure WHISPER_CLI_PATH e WHISPER_MODEL_PATH no .env para transcrever voz (whisper.cpp + modelo). Veja README.',
    );
  } else {
    logger.info(
      {
        whisperCli: env.WHISPER_CLI_PATH,
        whisperModel: env.WHISPER_MODEL_PATH,
        whisperLang: env.WHISPER_LANG,
      },
      'Transcrição de áudio habilitada (whisper.cpp)',
    );
  }

  await wiring.baileys.start();
  wiring.proactive.start();
  wiring.reminderScheduler.start();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'HTTP ouvindo');

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      shutdown(sig);
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
