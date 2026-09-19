import { describe, expect, it } from 'vitest';
import { normalizeError } from './normalize.js';

describe('normalizeError', () => {
  it('produces identical text for the same failure on different runs', () => {
    const first = normalizeError(
      '2026-09-19T13:37:11.4365403Z Error at /home/runner/work/api/api/src/app.ts:42:7 after 12.4s (pid 1234)',
    );
    const second = normalizeError(
      '2026-09-20T09:02:55.1111111Z Error at /home/runner/work/api/api/src/app.ts:57:2 after 9.1s (pid 98)',
    );

    expect(first).toBe(second);
  });

  it.each([
    ['/home/runner/work/api/api/src/app.ts', '<path>/app.ts'],
    ['a1b2c3d4-e5f6-7890-abcd-ef1234567890', '<uuid>'],
    ['0xdeadbeef', '<hex>'],
    ['9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456', '<sha>'],
    ['listening on localhost:5432', 'listening on <host>:<port>'],
    ['connect to 10.0.0.5', 'connect to <ip>'],
    ['finished in 1.5s', 'finished in <duration>'],
  ])('replaces %s', (input, expected) => {
    expect(normalizeError(input)).toBe(expected);
  });

  it('keeps the wording of the error and its identifiers', () => {
    const normalized = normalizeError('src/app.ts(3,5): error TS2345: Argument of type string');
    expect(normalized).toContain('error TS2345');
    expect(normalized).toContain('Argument of type string');
  });

  it('collapses blank lines and repeated whitespace', () => {
    expect(normalizeError('  a   b  \n\n   \n c ')).toBe('a b\nc');
  });

  it('is idempotent', () => {
    const once = normalizeError('Failed at /tmp/build/x.js:10:2 in 3s');
    expect(normalizeError(once)).toBe(once);
  });
});
