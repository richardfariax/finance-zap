import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { registerDevRoutes } from './routes/dev.routes.js';
import { registerReportRoutes } from './routes/report.routes.js';
import type { AppWiring } from './wiring.js';

export async function buildHttpApp(wiring: AppWiring): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: env.NODE_ENV === 'production',
  });

  await app.register(sensible);

  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    app.log.error({ err }, 'Unhandled error');
    void reply.status(status).send({
      error: err.name,
      message: err.message,
    });
  });

  app.get('/health', () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.get('/metrics/simple', () => ({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  }));

  registerReportRoutes(app, wiring);
  registerDevRoutes(app, wiring);

  return app;
}
