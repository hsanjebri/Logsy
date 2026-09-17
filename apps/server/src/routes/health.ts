import { pingDatabase, type Database } from '@logsy/db';
import type { FastifyPluginCallback } from 'fastify';

export interface HealthRoutesOptions {
  db: Database;
}

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, { db }, done) => {
  app.get('/healthz', async (request, reply) => {
    try {
      await pingDatabase(db);
      return await reply.send({ status: 'ok' });
    } catch (error) {
      request.log.error({ err: error }, 'health check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  done();
};
