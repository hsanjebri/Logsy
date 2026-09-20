/**
 * Per-installation rate limiting for webhook deliveries.
 *
 * A signed delivery is authentic, but authenticity is not moderation: one very busy
 * (or misbehaving) installation should not be able to fill the queue for everyone
 * else. Counting happens in memory, which is enough for a single receiver; the
 * limit is per installation, never global, so one noisy account cannot starve the rest.
 */

export interface RateLimitOptions {
  /** Deliveries allowed per installation within the window. */
  max?: number;
  windowMs?: number;
  /** Injected in tests. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfterSeconds: number;
  remaining: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(installationId: number): RateLimitDecision;
  /** Installations currently being counted. Useful as a gauge, and in tests. */
  size(): number;
}

const DEFAULT_MAX = 300;
const DEFAULT_WINDOW_MS = 60_000;

export function createRateLimiter(options: RateLimitOptions = {}): RateLimiter {
  const max = options.max ?? DEFAULT_MAX;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now;
  const buckets = new Map<number, Bucket>();

  return {
    check(installationId) {
      const at = now();
      const bucket = buckets.get(installationId);

      if (!bucket || bucket.resetAt <= at) {
        // Expired buckets are replaced, which also keeps the map from growing forever.
        for (const [key, value] of buckets) {
          if (value.resetAt <= at) buckets.delete(key);
        }
        buckets.set(installationId, { count: 1, resetAt: at + windowMs });
        return { allowed: true, retryAfterSeconds: 0, remaining: max - 1 };
      }

      bucket.count += 1;
      const remaining = Math.max(0, max - bucket.count);
      if (bucket.count > max) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - at) / 1000)),
          remaining: 0,
        };
      }
      return { allowed: true, retryAfterSeconds: 0, remaining };
    },
    size: () => buckets.size,
  };
}

/** The installation a delivery belongs to, when the payload names one. */
export function installationIdOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || !('installation' in payload)) return null;
  const { installation } = payload as { installation?: { id?: unknown } };
  return typeof installation?.id === 'number' ? installation.id : null;
}
