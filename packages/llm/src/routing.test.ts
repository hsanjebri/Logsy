import { describe, expect, it } from 'vitest';
import { createRoutingProvider } from './routing.js';
import type { AnalysisInput, LlmAnalysis, LlmProvider } from './types.js';

function stub(model: string, calls: string[]): LlmProvider {
  return {
    name: 'anthropic',
    model,
    analyze: (): Promise<LlmAnalysis> => {
      calls.push(model);
      return Promise.resolve({
        result: {
          category: 'unknown',
          title: 'x',
          rootCause: 'x',
          evidence: [],
          likelyFiles: [],
          suggestedFix: 'x',
          isLikelyFlaky: false,
          confidence: 0.5,
        },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        latencyMs: 0,
        model,
        promptVersion: 'v1',
        attempts: 1,
        fellBack: false,
      });
    },
  };
}

function input(excerptLength: number): AnalysisInput {
  return {
    excerpt: 'x'.repeat(excerptLength),
    repoFullName: 'acme/api',
    workflowName: 'CI',
    jobName: 'test',
    stepName: null,
  };
}

describe('createRoutingProvider', () => {
  it('sends short excerpts to the cheaper model', async () => {
    const calls: string[] = [];
    const provider = createRoutingProvider({
      primary: stub('claude-opus-5', calls),
      fast: stub('claude-haiku-4-5', calls),
      fastMaxChars: 2_000,
    });

    await provider.analyze(input(500));

    expect(calls).toEqual(['claude-haiku-4-5']);
  });

  it('sends long excerpts to the primary model', async () => {
    const calls: string[] = [];
    const provider = createRoutingProvider({
      primary: stub('claude-opus-5', calls),
      fast: stub('claude-haiku-4-5', calls),
      fastMaxChars: 2_000,
    });

    await provider.analyze(input(9_000));

    expect(calls).toEqual(['claude-opus-5']);
  });

  it('routes exactly at the threshold to the fast model', async () => {
    const calls: string[] = [];
    const provider = createRoutingProvider({
      primary: stub('primary', calls),
      fast: stub('fast', calls),
      fastMaxChars: 100,
    });

    await provider.analyze(input(100));
    await provider.analyze(input(101));

    expect(calls).toEqual(['fast', 'primary']);
  });
});
