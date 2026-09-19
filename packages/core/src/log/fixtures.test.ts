/**
 * Runs the whole pipeline over the real CI logs in evals/fixtures/.
 * Reading files is fine here: only the tests touch the filesystem, not the package.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containsSecret } from '../redact.js';
import { extractFailureContext } from './extract.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../evals/fixtures/', import.meta.url));

interface FixtureLabels {
  source: string;
  ecosystem?: string;
  jobName: string;
  stepName: string | null;
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith('.log'))
  .map((name) => {
    const log = readFileSync(`${FIXTURES_DIR}${name}`, 'utf8');
    const labels = JSON.parse(
      readFileSync(`${FIXTURES_DIR}${name.replace(/\.log$/, '.json')}`, 'utf8'),
    ) as FixtureLabels;
    return { name, log, labels };
  });

const MAX_CHARS = 12_000;

describe('extractFailureContext over real CI logs', () => {
  it('has fixtures to run against', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtures)('$name has complete labels', ({ labels }) => {
    expect(labels.source).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(labels.jobName.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$name', ({ log }) => {
    const context = extractFailureContext(log, { maxChars: MAX_CHARS });

    it('stays within the budget and shrinks large logs', () => {
      expect(context.charsExcerpt).toBeLessThanOrEqual(MAX_CHARS);
      expect(context.charsOriginal).toBe(log.length);
      if (log.length > MAX_CHARS) {
        expect(context.charsExcerpt).toBeLessThan(context.charsOriginal);
      }
    });

    it('produces a non-empty excerpt with no secrets and no escape codes', () => {
      expect(context.excerpt.trim().length).toBeGreaterThan(0);
      expect(containsSecret(context.excerpt)).toBe(false);
      // eslint-disable-next-line no-control-regex -- asserting escapes are gone
      expect(context.excerpt).not.toMatch(/\[/);
      expect(context.excerpt).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m);
    });

    it('identifies a failing step', () => {
      expect(context.stepName).not.toBeNull();
      expect(context.stepName).not.toBe('');
    });

    it('finds an error region that looks like a failure', () => {
      expect(context.region).toBeDefined();
      expect(context.region?.anchors.length).toBeGreaterThan(0);
      expect(context.normalizedError.trim().length).toBeGreaterThan(0);
    });

    it('normalizes the error to something run-independent', () => {
      expect(context.normalizedError).not.toMatch(/\/home\/runner\/work\/[\w-]+\/[\w-]+\//);
      expect(context.normalizedError).not.toMatch(/\b[0-9a-f]{40}\b/);
    });
  });
});

describe('error region quality', () => {
  it.each(fixtures)('$name points at a root cause when one exists', ({ log }) => {
    const { region } = extractFailureContext(log, { maxChars: MAX_CHARS });
    const anchorText = region?.anchors.map((anchor) => anchor.text).join('\n') ?? '';

    // A cascade-only region is acceptable only if the log really has nothing better.
    if (region?.priority === 'cascade') {
      expect(anchorText).toMatch(/exit code|canceled/i);
    } else {
      expect(anchorText).not.toMatch(/^##\[error\]Process completed with exit code/);
    }
  });
});

describe('performance', () => {
  it.each(fixtures)('$name is extracted quickly', ({ log }) => {
    const started = performance.now();
    extractFailureContext(log, { maxChars: MAX_CHARS });
    // Generous, but far below the seconds a backtracking pattern would take.
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
