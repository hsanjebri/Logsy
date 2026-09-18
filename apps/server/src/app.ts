import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhooks.js';
import type { WebhookDeps } from './webhooks/handlers.js';

export interface AppOptions extends WebhookDeps {
  webhookSecret: string;
  logger?: FastifyServerOptions['logger'];
}

/** GitHub caps webhook payloads at 25 MB. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildApp({
  db,
  queue,
  webhookSecret,
  logger = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: MAX_BODY_BYTES });

  app.setErrorHandler((error, request, reply) => {
    // Fastify's own errors (body too large, unsupported media type, ...) carry a 4xx statusCode.
    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: error instanceof Error ? error.message : 'bad request' });
    }
    request.log.error({ err: error }, 'request failed');
    // Never leak internals (queries, stack traces) to the caller.
    return reply.code(500).send({ error: 'internal server error' });
  });

  void app.register(healthRoutes, { db });
  void app.register(webhookRoutes, { db, queue, webhookSecret });

  return app;
}
