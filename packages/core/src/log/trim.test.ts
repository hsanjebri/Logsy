import { describe, expect, it } from 'vitest';
import { joinWithinBudget, omissionMarker, trimToBudget } from './trim.js';

describe('trimToBudget', () => {
  it('returns short text unchanged', () => {
    expect(trimToBudget('one\ntwo', 100)).toBe('one\ntwo');
  });

  it('keeps the head and the tail and marks the cut', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');

    const trimmed = trimToBudget(text, 200);

    expect(trimmed.length).toBeLessThanOrEqual(200);
    expect(trimmed).toContain('line 0');
    expect(trimmed).toContain('line 99');
    expect(trimmed).toMatch(/\.\.\. \[\d+ lines omitted\] \.\.\./);
  });

  it('accounts for every line it drops', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');

    const trimmed = trimToBudget(text, 120);
    const omitted = Number(/\[(\d+) lines omitted\]/.exec(trimmed)?.[1]);
    const kept = trimmed.split('\n').length - 1;

    expect(omitted + kept).toBe(50);
  });

  it('never splits a line in the middle', () => {
    const text = ['short', 'a'.repeat(300), 'end'].join('\n');
    for (const line of trimToBudget(text, 100).split('\n')) {
      expect(['short', 'end', omissionMarker(1)]).toContain(line);
    }
  });
});

describe('joinWithinBudget', () => {
  it('gives more of the budget to the heavier section', () => {
    const head = Array.from({ length: 200 }, (_, i) => `head ${i}`);
    const error = Array.from({ length: 200 }, (_, i) => `error ${i}`);

    const joined = joinWithinBudget(
      [
        { lines: head, weight: 1 },
        { lines: error, weight: 4 },
      ],
      1_000,
    );

    const headKept = joined.split('\n').filter((line) => line.startsWith('head ')).length;
    const errorKept = joined.split('\n').filter((line) => line.startsWith('error ')).length;
    expect(joined.length).toBeLessThanOrEqual(1_000);
    expect(errorKept).toBeGreaterThan(headKept);
  });

  it('skips empty sections', () => {
    expect(
      joinWithinBudget(
        [
          { lines: [], weight: 1 },
          { lines: ['only'], weight: 1 },
        ],
        100,
      ),
    ).toBe('only');
  });
});
