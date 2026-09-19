import { describe, expect, it } from 'vitest';
import { analysisResultSchema } from './analysis.js';
import { RULES, matchRule, ruleToAnalysis } from './rules.js';

describe('rule definitions', () => {
  it('covers the failure classes the spec lists', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique ids', () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps titles short enough for a comment heading', () => {
    for (const rule of RULES) {
      expect(rule.title.length, rule.id).toBeLessThanOrEqual(80);
    }
  });

  it('gives every rule an explanation, a fix and at least one example', () => {
    for (const rule of RULES) {
      expect(rule.explanation.length, rule.id).toBeGreaterThan(20);
      expect(rule.suggestedFix.length, rule.id).toBeGreaterThan(20);
      expect(rule.examples.length, rule.id).toBeGreaterThan(0);
    }
  });
});

describe('every rule matches its own examples', () => {
  it.each(RULES.flatMap((rule) => rule.examples.map((example) => ({ rule, example }))))(
    '$rule.id matches "$example"',
    ({ rule, example }) => {
      expect(rule.pattern.test(example)).toBe(true);
    },
  );
});

describe('matchRule', () => {
  it.each(RULES.map((rule) => ({ id: rule.id, example: rule.examples[0] ?? '' })))(
    'resolves $id from its first example',
    ({ id, example }) => {
      // A later rule may legitimately win on a shared line; the match must at least
      // be a rule whose own pattern covers this example.
      const match = matchRule(example);
      expect(match).toBeDefined();
      expect(match?.rule.pattern.test(example)).toBe(true);
      if (match?.rule.id !== id) {
        expect(RULES.findIndex((r) => r.id === match?.rule.id)).toBeLessThan(
          RULES.findIndex((r) => r.id === id),
        );
      }
    },
  );

  it('returns the matching lines as evidence, at most five', () => {
    const log = [
      'npm ERR! code ERESOLVE',
      'npm ERR! ERESOLVE unable to resolve dependency tree',
      'npm ERR! Found: react@18.2.0',
    ].join('\n');

    const match = matchRule(log);

    expect(match?.rule.id).toBe('npm-eresolve');
    expect(match?.evidence).toEqual(['npm ERR! ERESOLVE unable to resolve dependency tree']);
    expect(match?.evidence.length).toBeLessThanOrEqual(5);
  });

  it('prefers the more specific rule when two could apply', () => {
    // Out of memory also exits non-zero, but the OOM rule is the useful answer.
    const match = matchRule(
      [
        '<--- Last few GCs --->',
        'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      ].join('\n'),
    );
    expect(match?.rule.id).toBe('out-of-memory');
  });

  it('returns undefined for output it does not recognize', () => {
    expect(matchRule('Everything went fine\nBuild succeeded in 12s')).toBeUndefined();
  });

  it('does not match on ordinary successful output', () => {
    const log = [
      'added 402 packages in 11s',
      '38819 passing (48s)',
      'Build completed successfully',
      'Downloading from central: https://repo.maven.apache.org/maven2/org/x/1.0/x-1.0.jar',
    ].join('\n');
    expect(matchRule(log)).toBeUndefined();
  });
});

describe('ruleToAnalysis', () => {
  it('produces a valid analysis result', () => {
    for (const rule of RULES) {
      const analysis = ruleToAnalysis({ rule, evidence: rule.examples.slice(0, 1) });
      expect(analysisResultSchema.safeParse(analysis).success, rule.id).toBe(true);
      expect(analysis.category).toBe(rule.category);
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('marks infrastructure noise as likely flaky', () => {
    const network = RULES.find((rule) => rule.id === 'network-failure');
    const eslint = RULES.find((rule) => rule.id === 'eslint-failure');

    expect(network && ruleToAnalysis({ rule: network, evidence: [] }).isLikelyFlaky).toBe(true);
    expect(eslint && ruleToAnalysis({ rule: eslint, evidence: [] }).isLikelyFlaky).toBe(false);
  });
});
