import type { TestResultRecord } from './junit.js';

/**
 * Flakiness is decided by evidence, never by guessing: the same commit both passed
 * and failed the same test, so the code cannot be the difference.
 */

export interface FlakyTestRef {
  suite: string;
  testName: string;
}

export interface FlakyDetection extends FlakyTestRef {
  passed: number;
  failed: number;
}

/**
 * Tests that both passed and failed within `results`. Callers pass the results of a
 * single commit (across attempts and jobs), which is what makes the verdict sound.
 */
export function detectFlakyTests(results: readonly TestResultRecord[]): FlakyDetection[] {
  const counts = new Map<string, FlakyDetection>();

  for (const result of results) {
    if (result.status === 'skipped') continue;
    const key = testKey(result);
    const entry = counts.get(key) ?? {
      suite: result.suite,
      testName: result.testName,
      passed: 0,
      failed: 0,
    };
    if (result.status === 'passed') entry.passed += 1;
    else entry.failed += 1;
    counts.set(key, entry);
  }

  return [...counts.values()].filter((entry) => entry.passed > 0 && entry.failed > 0);
}

export function testKey(test: FlakyTestRef): string {
  return `${test.suite}\u0000${test.testName}`;
}

/** The sentence shown in the PR comment for a test already known to be flaky. */
export function flakyNote(test: FlakyTestRef & { flipCount: number }): string {
  const flips = test.flipCount === 1 ? '1 flip' : `${String(test.flipCount)} flips`;
  return `\`${test.suite}.${test.testName}\` is known flaky: ${flips} recorded`;
}
