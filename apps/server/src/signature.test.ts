import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature.js';

const secret = "It's a Secret to Everybody";
const body = Buffer.from('Hello, World!');

describe('webhook signatures', () => {
  it('matches the example from the GitHub documentation', () => {
    expect(signPayload(secret, body)).toBe(
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    );
  });

  it('accepts a valid signature', () => {
    expect(verifySignature(secret, body, signPayload(secret, body))).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['wrong prefix', signPayload(secret, body).replace('sha256=', 'sha1=')],
    ['wrong secret', signPayload('another-secret', body)],
    ['tampered body', signPayload(secret, 'Hello, World?')],
    ['truncated digest', signPayload(secret, body).slice(0, -1)],
    ['uppercase digest', signPayload(secret, body).toUpperCase()],
  ])('rejects %s', (_name, header) => {
    expect(verifySignature(secret, body, header)).toBe(false);
  });
});
