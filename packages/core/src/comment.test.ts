import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './analysis.js';
import {
  COMMENT_MARKER,
  categoryLabel,
  formatFailureComment,
  formatPassingComment,
  type CommentContext,
} from './comment.js';

const analysis: AnalysisResult = {
  category: 'dependency_error',
  title: 'npm could not resolve the dependency tree',
  rootCause: 'react-dom@18 requires react@^18, but the lockfile pins react@19.',
  evidence: ['npm ERR! ERESOLVE unable to resolve dependency tree'],
  likelyFiles: [{ path: 'package.json', line: 21, reason: 'declares the conflicting versions' }],
  suggestedFix: 'Align the react versions, then commit the updated lockfile.',
  isLikelyFlaky: false,
  confidence: 0.9,
};

const base: CommentContext = {
  analysis,
  source: 'rule',
  repoFullName: 'acme/api',
  workflowName: 'CI',
  jobName: 'build (22)',
  stepName: 'npm ci',
  runUrl: 'https://github.com/acme/api/actions/runs/42',
  errorExcerpt: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree',
  headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
};

describe('formatFailureComment', () => {
  it('renders the full comment', () => {
    expect(formatFailureComment(base)).toMatchInlineSnapshot(`
      "<!-- logsy:comment -->

      ### npm could not resolve the dependency tree

      📦 Dependency error · **build (22)** › npm ci · [view run](https://github.com/acme/api/actions/runs/42)

      react-dom@18 requires react@^18, but the lockfile pins react@19.

      <details>
      <summary>Evidence from the log</summary>

      \`\`\`
      npm ERR! ERESOLVE unable to resolve dependency tree
      \`\`\`
      </details>

      **Likely files**

      - \`package.json:21\` — declares the conflicting versions

      **Suggested fix**

      Align the react versions, then commit the updated lockfile.

      ---

      <sub>matched a known failure pattern · confidence 90% · [Logsy](https://github.com/hsanjebri/Logsy) for \`9f2c1ab\`</sub>"
    `);
  });

  it('always starts with the marker so the comment can be found and updated', () => {
    expect(formatFailureComment(base).startsWith(COMMENT_MARKER)).toBe(true);
    expect(
      formatPassingComment({ workflowName: 'CI', runUrl: 'x' }).startsWith(COMMENT_MARKER),
    ).toBe(true);
  });

  it('says nothing speculative below the confidence bar', () => {
    const comment = formatFailureComment({
      ...base,
      analysis: { ...analysis, confidence: 0.3 },
    });

    expect(comment).toContain('### CI failed');
    expect(comment).toContain('not confident enough');
    expect(comment).toContain('Error excerpt');
    // No guessed cause, no invented fix, no likely files.
    expect(comment).not.toContain(analysis.rootCause);
    expect(comment).not.toContain(analysis.suggestedFix);
    expect(comment).not.toContain('Likely files');
    expect(comment).not.toContain('confidence');
  });

  it('mentions recurrence only when it has happened before', () => {
    expect(formatFailureComment({ ...base, seenCount: 1 })).not.toContain('Seen');
    expect(formatFailureComment({ ...base, seenCount: 4 })).toContain(
      'Seen 4 times in this repository',
    );
  });

  it('links likely files to the pull request diff when the PR is known', () => {
    expect(formatFailureComment({ ...base, prNumber: 7 })).toContain(
      '(https://github.com/acme/api/pull/7/files)',
    );
  });

  it('adds feedback links only when an endpoint and analysis id exist', () => {
    expect(formatFailureComment(base)).not.toContain('Was this helpful?');
    const withFeedback = formatFailureComment({
      ...base,
      feedbackBaseUrl: 'https://logsy.example.com/',
      analysisId: 12,
    });
    expect(withFeedback).toContain('https://logsy.example.com/feedback/12?verdict=helpful');
    expect(withFeedback).toContain('verdict=wrong');
  });

  it('names the LLM when the analysis came from one', () => {
    expect(formatFailureComment({ ...base, source: 'llm', model: 'claude-opus-5' })).toContain(
      'analyzed by claude-opus-5',
    );
    expect(formatFailureComment({ ...base, source: 'cache' })).toContain(
      'reused an earlier analysis',
    );
  });

  it('flags a flaky-looking failure and a known flaky test', () => {
    const comment = formatFailureComment({
      ...base,
      analysis: { ...analysis, isLikelyFlaky: true },
      flakyNote: '`OrderServiceTest.retries` is known flaky: 7 flips in 30 days',
    });

    expect(comment).toContain('known flaky: 7 flips');
    expect(comment).toContain('looks flaky rather than caused by your change');
  });

  it('falls back to the error excerpt when the analysis has no evidence', () => {
    const comment = formatFailureComment({ ...base, analysis: { ...analysis, evidence: [] } });
    expect(comment).toContain('Error excerpt');
    expect(comment).toContain('npm ERR! code ERESOLVE');
  });
});

describe('formatPassingComment', () => {
  it('replaces the failure with a short resolved note', () => {
    expect(
      formatPassingComment({
        workflowName: 'CI',
        runUrl: 'https://github.com/acme/api/actions/runs/43',
        headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
      }),
    ).toMatchInlineSnapshot(`
      "<!-- logsy:comment -->

      ### ✅ CI is passing again

      The previously reported failure is resolved. [View run](https://github.com/acme/api/actions/runs/43)

      ---

      <sub>[Logsy](https://github.com/hsanjebri/Logsy) for \`9f2c1ab\`</sub>"
    `);
  });
});

describe('categoryLabel', () => {
  it('gives every category a readable badge', () => {
    expect(categoryLabel('out_of_memory')).toBe('💾 Out of memory');
    expect(categoryLabel('unknown')).toBe('❓ Unknown');
  });
});
