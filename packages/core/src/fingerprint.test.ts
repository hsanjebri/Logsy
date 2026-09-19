import { describe, expect, it } from 'vitest';
import { fingerprint, isPlaceholderFingerprint } from './fingerprint.js';

const error = [
  'Error: connect ECONNREFUSED 127.0.0.1:5432',
  '    at TCPConnectWrap.afterConnect (node:net:1611:16)',
].join('\n');

describe('fingerprint', () => {
  it('is stable for the same failure', () => {
    expect(fingerprint({ normalizedError: error, stepName: 'npm test' })).toBe(
      fingerprint({ normalizedError: error, stepName: 'npm test' }),
    );
  });

  it('ignores run-specific detail such as ports, paths and timings', () => {
    const first = fingerprint({
      normalizedError: 'Error: timeout after 30.2s at /home/runner/work/api/api/src/db.ts:14:3',
      stepName: 'npm test',
    });
    const second = fingerprint({
      normalizedError: 'Error: timeout after 11.7s at /home/runner/work/api/api/src/db.ts:88:9',
      stepName: 'npm test',
    });
    expect(first).toBe(second);
  });

  it('separates different errors', () => {
    expect(fingerprint({ normalizedError: error, stepName: 'npm test' })).not.toBe(
      fingerprint({ normalizedError: 'Error: something else entirely', stepName: 'npm test' }),
    );
  });

  it('separates the same error in different steps', () => {
    expect(fingerprint({ normalizedError: error, stepName: 'npm test' })).not.toBe(
      fingerprint({ normalizedError: error, stepName: 'npm run build' }),
    );
  });

  it('ignores lines beyond the significant ones', () => {
    const withTail = `${error}\n${Array.from({ length: 30 }, (_, i) => `frame ${i}`).join('\n')}`;
    const shared = (text: string) => fingerprint({ normalizedError: text, stepName: 'npm test' });
    // The first five lines decide; deeper stack frames must not change the identity.
    expect(shared(`${error}\nframe 0\nframe 1\nframe 2`)).toBe(shared(withTail));
  });

  it('is versioned and short enough to index', () => {
    const value = fingerprint({ normalizedError: error, stepName: null });
    expect(value).toMatch(/^v1:[0-9a-f]{32}$/);
  });

  it('tolerates a missing step name', () => {
    expect(() => fingerprint({ normalizedError: error })).not.toThrow();
  });
});

describe('isPlaceholderFingerprint', () => {
  it('recognizes the placeholders written before an analysis exists', () => {
    expect(isPlaceholderFingerprint('pending:abc')).toBe(true);
    expect(isPlaceholderFingerprint(fingerprint({ normalizedError: error }))).toBe(false);
  });
});
