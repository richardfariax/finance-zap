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

  await wiring.baileys.start();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'HTTP ouvindo');

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
