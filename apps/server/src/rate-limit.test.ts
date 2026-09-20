import { describe, expect, it } from 'vitest';
import { createRateLimiter, installationIdOf } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('allows deliveries up to the limit and refuses the next one', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => 0 });

    expect(limiter.check(1).allowed).toBe(true);
    expect(limiter.check(1).allowed).toBe(true);
    expect(limiter.check(1)).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 0 });
    expect(limiter.check(1)).toEqual({ allowed: false, retryAfterSeconds: 60, remaining: 0 });
  });

  it('counts each installation separately', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });

    expect(limiter.check(1).allowed).toBe(true);
    expect(limiter.check(1).allowed).toBe(false);
    // A busy installation must not spend anyone else's budget.
    expect(limiter.check(2).allowed).toBe(true);
  });

  it('starts a fresh window once the old one has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });

    expect(limiter.check(1).allowed).toBe(true);
    expect(limiter.check(1).allowed).toBe(false);

    now = 1_000;
    expect(limiter.check(1).allowed).toBe(true);
  });

  it('rounds Retry-After up, so it is never zero while blocked', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });

    limiter.check(1);
    now = 999;
    expect(limiter.check(1).retryAfterSeconds).toBe(1);
  });

  it('drops expired buckets instead of remembering every installation forever', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 5, windowMs: 1_000, now: () => now });

    for (let id = 1; id <= 50; id += 1) limiter.check(id);
    expect(limiter.size()).toBe(50);

    now = 2_000;
    limiter.check(999);

    // Only the bucket just created survives; the map is not a leak.
    expect(limiter.size()).toBe(1);
  });
});

describe('installationIdOf', () => {
  it('reads the installation id from a payload that has one', () => {
    expect(installationIdOf({ installation: { id: 42 } })).toBe(42);
  });

  it('returns null when the payload names no installation', () => {
    expect(installationIdOf({})).toBeNull();
    expect(installationIdOf(null)).toBeNull();
    expect(installationIdOf('not an object')).toBeNull();
    expect(installationIdOf({ installation: {} })).toBeNull();
    expect(installationIdOf({ installation: { id: 'abc' } })).toBeNull();
  });
});
