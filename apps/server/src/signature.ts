import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/** The `X-Hub-Signature-256` value GitHub sends for `body`. */
export function signPayload(secret: string, body: Buffer | string): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifies `X-Hub-Signature-256` against the exact raw request body, in constant time.
 * Must run on the raw bytes: re-serialized JSON would not match.
 */
export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (header?.startsWith(PREFIX) !== true) return false;
  const expected = Buffer.from(signPayload(secret, body));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
