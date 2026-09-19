import { createHash } from 'node:crypto';
import { normalizeError } from './log/normalize.js';

/**
 * Identifies "the same failure" across runs and repositories, so a recurring
 * problem can be recognized and its analysis reused.
 */

export interface FingerprintInput {
  /** Output of {@link normalizeError}; normalized here if not already. */
  normalizedError: string;
  /** Failing step name, which separates identical errors in different steps. */
  stepName?: string | null;
  /** Extra scope, e.g. a category, when two errors normalize the same way. */
  scope?: string | null;
}

/** Number of leading error lines that identify a failure. */
const SIGNIFICANT_LINES = 5;
const VERSION = 'v1';

/**
 * SHA-256 over the top normalized error lines plus the step name, prefixed with a
 * version so the scheme can change without colliding with older fingerprints.
 */
export function fingerprint(input: FingerprintInput): string {
  const lines = normalizeError(input.normalizedError)
    .split('\n')
    .filter((line) => line !== '')
    .slice(0, SIGNIFICANT_LINES);

  const material = [input.scope ?? '', input.stepName?.trim() ?? '', ...lines].join('\n');
  const digest = createHash('sha256').update(material, 'utf8').digest('hex');
  return `${VERSION}:${digest.slice(0, 32)}`;
}

/** True for fingerprints written before an analysis existed (Phase 2 placeholders). */
export function isPlaceholderFingerprint(value: string): boolean {
  return value.startsWith('pending:');
}
