import { claimDelivery, completeDelivery } from '@logsy/db';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { createRateLimiter, installationIdOf, type RateLimiter } from '../rate-limit.js';
import { verifySignature } from '../signature.js';
import { handleWebhookEvent, type WebhookDeps } from '../webhooks/handlers.js';
import { readAction } from '../webhooks/payloads.js';

export interface WebhookRoutesOptions extends WebhookDeps {
  webhookSecret: string;
  /** Defaults to 300 deliveries per installation per minute. */
  rateLimiter?: RateLimiter;
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
  { db, queue, webhookSecret, rateLimiter = createRateLimiter() },
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

    // One installation cannot crowd out the others, however busy it gets.
    const installationId = installationIdOf(payload);
    if (installationId !== null) {
      const decision = rateLimiter.check(installationId);
      if (!decision.allowed) {
        log.warn({ installationId }, 'installation rate limit exceeded');
        return reply
          .code(429)
          .header('retry-after', String(decision.retryAfterSeconds))
          .send({ error: 'too many deliveries' });
      }
    }

    const claimed = await claimDelivery(db, { deliveryId, event, action: readAction(payload) });
    if (!claimed) {
      log.info('duplicate delivery skipped');
      return reply.code(200).send({ status: 'duplicate' });
    }

    try {
      const outcome = await handleWebhookEvent({ db, queue }, event, payload, log);
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
