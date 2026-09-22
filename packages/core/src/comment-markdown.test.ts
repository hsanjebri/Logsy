import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './analysis.js';
import { formatFailureComment } from './comment.js';
import { parseCommentMarkdown, parseInline } from './comment-markdown.js';

const analysis: AnalysisResult = {
  category: 'test_failure',
  title: 'Discount test failed',
  rootCause: 'The discount is applied once instead of twice.',
  evidence: ['AssertionError: expected 90 to be 81'],
  likelyFiles: [{ path: 'src/cart.ts', line: 12, reason: 'computes the discount' }],
  suggestedFix: 'Apply it per item:\n\n```ts\ntotal = items.map(applyDiscount)\n```',
  isLikelyFlaky: true,
  confidence: 0.9,
};

function comment(overrides: Partial<AnalysisResult> = {}) {
  return formatFailureComment({
    analysis: { ...analysis, ...overrides },
    source: 'llm',
    repoFullName: 'acme/shop',
    workflowName: 'CI',
    jobName: 'test',
    stepName: 'npm test',
    runUrl: 'https://github.com/acme/shop/actions/runs/1',
    errorExcerpt: 'FAIL src/cart.test.ts\n</details>\nAssertionError',
    seenCount: 3,
    prNumber: 7,
    model: 'test-model',
  });
}

describe('parseCommentMarkdown', () => {
  it('reads every part of a confident comment', () => {
    const blocks = parseCommentMarkdown(comment());
    const types = blocks.map((block) => block.type);

    expect(blocks[0]).toEqual({
      type: 'heading',
      children: [{ type: 'text', text: 'Discount test failed' }],
    });
    expect(types).toContain('details');
    expect(types).toContain('list');
    expect(types).toContain('code');
    expect(types).toContain('quote');
    expect(types.slice(-2)).toEqual(['rule', 'small']);

    const details = blocks.find((block) => block.type === 'details');
    expect(details).toMatchObject({
      summary: [{ type: 'text', text: 'Evidence from the log' }],
      children: [{ type: 'code', text: 'AssertionError: expected 90 to be 81' }],
    });

    const fix = blocks.find((block) => block.type === 'code' && block.language === 'ts');
    expect(fix).toMatchObject({ text: 'total = items.map(applyDiscount)' });
  });

  it('keeps a code block intact even when it contains a closing details tag', () => {
    const blocks = parseCommentMarkdown(comment({ confidence: 0.2 }));
    const details = blocks.find((block) => block.type === 'details');

    expect(details).toMatchObject({
      summary: [{ type: 'text', text: 'Error excerpt' }],
      children: [{ type: 'code', text: 'FAIL src/cart.test.ts\n</details>\nAssertionError' }],
    });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(parseCommentMarkdown('first line\nsecond line')).toEqual([
      {
        type: 'paragraph',
        lines: [[{ type: 'text', text: 'first line' }], [{ type: 'text', text: 'second line' }]],
      },
    ]);
  });

  it('survives an unclosed fence or details block', () => {
    expect(parseCommentMarkdown('```\nno end')).toEqual([
      { type: 'code', language: null, text: 'no end' },
    ]);
    expect(parseCommentMarkdown('<details>\n<summary>S</summary>\nbody')[0]).toMatchObject({
      type: 'details',
    });
  });
});

describe('parseInline', () => {
  it('reads code, bold, italics and links, nesting where Markdown does', () => {
    expect(parseInline('**`src/a.ts:3`** see [the `run`](https://x.dev/r) _now_')).toEqual([
      { type: 'strong', children: [{ type: 'code', text: 'src/a.ts:3' }] },
      { type: 'text', text: ' see ' },
      {
        type: 'link',
        href: 'https://x.dev/r',
        children: [
          { type: 'text', text: 'the ' },
          { type: 'code', text: 'run' },
        ],
      },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'now' }] },
    ]);
  });

  it('never produces a link a browser would run', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[click](javascript:alert(1)' },
      { type: 'text', text: ')' },
    ]);
  });

  it('leaves HTML-looking model output as plain text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('does not read underscores inside identifiers as italics', () => {
    expect(parseInline('set MAX_OLD_SPACE_SIZE')).toEqual([
      { type: 'text', text: 'set MAX_OLD_SPACE_SIZE' },
    ]);
  });
});
