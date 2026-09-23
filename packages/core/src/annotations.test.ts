import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './analysis.js';
import { buildAnnotations, checkRunSummary, checkRunTitle } from './annotations.js';

const analysis: AnalysisResult = {
  category: 'test_failure',
  title: 'Discount test failed',
  rootCause: 'The discount is applied once instead of twice.',
  evidence: ['AssertionError: expected 90 to be 81'],
  likelyFiles: [
    { path: 'src/cart.ts', line: 42, reason: 'computes the discount' },
    { path: 'src/cart.test.ts', line: 14, reason: 'the failing assertion' },
  ],
  suggestedFix: 'Apply the discount per item.',
  isLikelyFlaky: false,
  confidence: 0.9,
};

const context = {
  analysis,
  changedFiles: ['src/cart.ts', 'README.md'],
  jobName: 'test',
  stepName: 'npm test',
};

describe('buildAnnotations', () => {
  it('annotates only the files the pull request changed', () => {
    expect(buildAnnotations(context)).toEqual([
      {
        path: 'src/cart.ts',
        start_line: 42,
        end_line: 42,
        annotation_level: 'failure',
        title: 'Discount test failed',
        message:
          'computes the discount.\n\nThe discount is applied once instead of twice.\n\nSuggested fix: Apply the discount per item.',
      },
    ]);
  });

  it('skips a file with no line, which GitHub cannot place', () => {
    const result = buildAnnotations({
      ...context,
      analysis: { ...analysis, likelyFiles: [{ path: 'src/cart.ts', reason: 'changed here' }] },
    });
    expect(result).toEqual([]);
  });

  it('marks a likely flaky failure as a warning rather than an error', () => {
    const [annotation] = buildAnnotations({
      ...context,
      analysis: { ...analysis, isLikelyFlaky: true },
    });
    expect(annotation?.annotation_level).toBe('warning');
  });

  it('says nothing inline when the analysis is not confident', () => {
    expect(buildAnnotations({ ...context, analysis: { ...analysis, confidence: 0.3 } })).toEqual(
      [],
    );
  });

  it("stays within GitHub's limit of fifty annotations", () => {
    const many = Array.from({ length: 60 }, (_unused, index) => ({
      path: `src/file${String(index)}.ts`,
      line: index + 1,
      reason: 'touched',
    }));
    const result = buildAnnotations({
      ...context,
      analysis: { ...analysis, likelyFiles: many },
      changedFiles: many.map((file) => file.path),
    });
    expect(result).toHaveLength(50);
  });
});

describe('the check run heading', () => {
  it('names the category, the step and the confidence', () => {
    expect(checkRunSummary(context)).toBe('🧪 Test failure · test › npm test · confidence 90%');
    expect(checkRunTitle(analysis)).toBe('Discount test failed');
  });

  it('admits when it does not know', () => {
    const unsure = { ...context, analysis: { ...analysis, confidence: 0.2 } };
    expect(checkRunSummary(unsure)).toContain('not confident enough');
    expect(checkRunTitle(unsure.analysis)).toBe('CI failed');
  });
});
