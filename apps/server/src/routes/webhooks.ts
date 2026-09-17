import { claimDelivery, completeDelivery, type Database } from '@logsy/db';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { verifySignature } from '../signature.js';
import { handleWebhookEvent } from '../webhooks/handlers.js';
import { readAction } from '../webhooks/payloads.js';

export interface WebhookRoutesOptions {
  db: Database;
  webhookSecret: string;
}

const headersSchema = z.object({
  'x-github-event': z.string().min(1),
  'x-github-delivery': z.string().min(1).max(100),
});

/**
 * POST /webhooks/github — verify, dedupe, handle, respond fast.
 * Registered as an encapsulated plugin so the raw-body JSON parser only applies here.
 */
export const webhookRoutes: FastifyPluginCallback<WebhookRoutesOptions> = (
  app,
  { db, webhookSecret },
  done,
) => {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, parsed) => {
    parsed(null, body);
  });

  app.post<{ Body: Buffer }>('/webhooks/github', async (request, reply) => {
    const signature = request.headers['x-hub-signature-256'];
    if (
      !Buffer.isBuffer(request.body) ||
      !verifySignature(
        webhookSecret,
        request.body,
        typeof signature === 'string' ? signature : undefined,
      )
    ) {
      request.log.warn('rejected webhook with invalid signature');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const headers = headersSchema.safeParse(request.headers);
    if (!headers.success) {
      return reply.code(400).send({ error: 'missing GitHub event or delivery headers' });
    }
    const { 'x-github-event': event, 'x-github-delivery': deliveryId } = headers.data;

    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'body is not valid JSON' });
    }

    const log = request.log.child({ deliveryId, event });
    const claimed = await claimDelivery(db, { deliveryId, event, action: readAction(payload) });
    if (!claimed) {
      log.info('duplicate delivery skipped');
      return reply.code(200).send({ status: 'duplicate' });
    }

    try {
      const outcome = await handleWebhookEvent(db, event, payload, log);
      await completeDelivery(db, deliveryId, outcome);
      return await reply.code(202).send({ status: outcome });
    } catch (error) {
      await completeDelivery(db, deliveryId, 'failed');
      if (error instanceof z.ZodError) {
        log.warn({ issues: error.issues }, 'unexpected webhook payload shape');
        return reply.code(422).send({ error: 'unexpected payload shape' });
      }
      throw error;
    }
  });
  done();
};
