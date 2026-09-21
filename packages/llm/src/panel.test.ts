import { MIN_COMMENT_CONFIDENCE, type AnalysisResult } from '@logsy/core';
import { describe, expect, it } from 'vitest';
import { fallbackResult } from './analyze.js';
import { DISAGREEMENT_CONFIDENCE, combinePanel, createPanelProvider } from './panel.js';
import type { AnalysisInput, LlmAnalysis, LlmProvider } from './types.js';

const input: AnalysisInput = {
  excerpt: 'FAIL src/cart.test.ts\nAssertionError: expected 90 to be 81',
  repoFullName: 'acme/shop',
  workflowName: 'CI',
  jobName: 'test',
  stepName: 'Run tests',
};

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    category: 'test_failure',
    title: 'Discount test failed',
    rootCause: 'The discount is applied once instead of twice.',
    evidence: ['AssertionError: expected 90 to be 81'],
    likelyFiles: [{ path: 'src/cart.ts', reason: 'changed in this PR' }],
    suggestedFix: 'Apply the discount per item.',
    isLikelyFlaky: false,
    confidence: 0.8,
    ...overrides,
  };
}

function answer(model: string, overrides: Partial<LlmAnalysis> = {}): LlmAnalysis {
  return {
    result: result(),
    usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costUsd: 0.001 },
    latencyMs: 1_000,
    model,
    promptVersion: 'v1',
    attempts: 1,
    fellBack: false,
    ...overrides,
  };
}

function member(name: 'groq' | 'gemini', respond: () => Promise<LlmAnalysis>): LlmProvider {
  return { name, model: `${name}-model`, analyze: respond };
}

describe('combinePanel', () => {
  it('keeps the most confident answer when the models agree, adding what the others found', () => {
    const combined = combinePanel([
      answer('a', { result: result({ confidence: 0.7, evidence: ['line A'] }) }),
      answer('b', {
        result: result({
          confidence: 0.9,
          title: 'Stronger title',
          evidence: ['line B', 'line A'],
          likelyFiles: [{ path: 'src/discount.ts', reason: 'computes the discount' }],
        }),
      }),
    ]);

    expect(combined.result.title).toBe('Stronger title');
    expect(combined.result.confidence).toBe(0.9);
    expect(combined.result.evidence).toEqual(['line B', 'line A']);
    expect(combined.result.likelyFiles.map((file) => file.path)).toEqual([
      'src/discount.ts',
      'src/cart.ts',
    ]);
    expect(combined.model).toBe('a + b');
  });

  it('drops below the comment threshold when the models disagree', () => {
    const combined = combinePanel([
      answer('a', { result: result({ category: 'test_failure', confidence: 0.9 }) }),
      answer('b', { result: result({ category: 'build_error', confidence: 0.85 }) }),
    ]);

    expect(combined.result.category).toBe('test_failure');
    expect(combined.result.confidence).toBe(DISAGREEMENT_CONFIDENCE);
    expect(combined.result.confidence).toBeLessThan(MIN_COMMENT_CONFIDENCE);
  });

  it('never raises the confidence of an already unsure answer', () => {
    const combined = combinePanel([
      answer('a', { result: result({ category: 'test_failure', confidence: 0.2 }) }),
      answer('b', { result: result({ category: 'build_error', confidence: 0.1 }) }),
    ]);
    expect(combined.result.confidence).toBe(0.2);
  });

  it('follows the majority, not the single most confident member', () => {
    const combined = combinePanel([
      answer('a', { result: result({ category: 'build_error', confidence: 0.95 }) }),
      answer('b', { result: result({ category: 'test_failure', confidence: 0.6 }) }),
      answer('c', { result: result({ category: 'test_failure', confidence: 0.7 }) }),
    ]);

    expect(combined.result.category).toBe('test_failure');
    expect(combined.result.confidence).toBe(0.7);
  });

  it('ignores a member that fell back, so one bad answer does not veto', () => {
    const combined = combinePanel([
      answer('a', { result: fallbackResult('invalid output'), fellBack: true, attempts: 2 }),
      answer('b', { result: result({ confidence: 0.8 }) }),
    ]);

    expect(combined.fellBack).toBe(false);
    expect(combined.result.confidence).toBe(0.8);
    expect(combined.model).toBe('b');
  });

  it('falls back only when every member did', () => {
    const combined = combinePanel([
      answer('a', { result: fallbackResult('x'), fellBack: true }),
      answer('b', { result: fallbackResult('y'), fellBack: true }),
    ]);
    expect(combined.fellBack).toBe(true);
    expect(combined.result.category).toBe('unknown');
  });

  it('adds up tokens and attempts, and reports the slowest member', () => {
    const combined = combinePanel([
      answer('a', { latencyMs: 1_500, attempts: 1 }),
      answer('b', { latencyMs: 5_000, attempts: 2 }),
    ]);

    expect(combined.usage.inputTokens).toBe(200);
    expect(combined.usage.outputTokens).toBe(100);
    expect(combined.usage.costUsd).toBeCloseTo(0.002);
    expect(combined.attempts).toBe(3);
    expect(combined.latencyMs).toBe(5_000);
  });

  it('reports an unknown cost rather than a partial one', () => {
    const combined = combinePanel([
      answer('a'),
      answer('b', { usage: { inputTokens: 1, outputTokens: 1, costUsd: null } }),
    ]);
    expect(combined.usage.costUsd).toBeNull();
  });
});

describe('createPanelProvider', () => {
  it('asks every member and names them all', async () => {
    const asked: string[] = [];
    const panel = createPanelProvider({
      members: [
        member('groq', () => {
          asked.push('groq');
          return Promise.resolve(answer('groq-model'));
        }),
        member('gemini', () => {
          asked.push('gemini');
          return Promise.resolve(answer('gemini-model'));
        }),
      ],
    });

    const analysis = await panel.analyze(input);
    expect(asked.sort()).toEqual(['gemini', 'groq']);
    expect(panel.name).toBe('panel');
    expect(panel.model).toBe('panel(groq:groq-model, gemini:gemini-model)');
    expect(analysis.model).toBe('groq-model + gemini-model');
  });

  it('answers with the members that succeeded when another is rate limited', async () => {
    const panel = createPanelProvider({
      members: [
        member('groq', () => Promise.reject(new Error('429 rate limit'))),
        member('gemini', () => Promise.resolve(answer('gemini-model'))),
      ],
    });

    const analysis = await panel.analyze(input);
    expect(analysis.model).toBe('gemini-model');
    expect(analysis.result.confidence).toBe(0.8);
  });

  it('throws when every member fails, so the job is retried', async () => {
    const panel = createPanelProvider({
      members: [
        member('groq', () => Promise.reject(new Error('429 rate limit'))),
        member('gemini', () => Promise.reject(new Error('503 unavailable'))),
      ],
    });
    await expect(panel.analyze(input)).rejects.toThrow('429 rate limit');
  });

  it('needs at least two members', () => {
    expect(() =>
      createPanelProvider({ members: [member('groq', () => Promise.resolve(answer('x')))] }),
    ).toThrow('at least two');
  });
});
