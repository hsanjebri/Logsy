import type { AnalysisResult } from '@logsy/core';
import { describe, expect, it } from 'vitest';
import { analyzeWithProvider, fallbackResult } from './analyze.js';
import { PROMPT_VERSION } from './prompt.js';
import type { AnalysisInput, CompletionFn, CompletionRequest, RawCompletion } from './types.js';

const input: AnalysisInput = {
  excerpt: 'npm ERR! ERESOLVE unable to resolve dependency tree',
  repoFullName: 'acme/api',
  workflowName: 'CI',
  jobName: 'build',
  stepName: 'npm ci',
};

const valid: AnalysisResult = {
  category: 'dependency_error',
  title: 'npm could not resolve the dependency tree',
  rootCause: 'Peer dependency conflict between react and react-dom.',
  evidence: ['npm ERR! ERESOLVE unable to resolve dependency tree'],
  likelyFiles: [{ path: 'package.json', reason: 'declares the conflicting versions' }],
  suggestedFix: 'Align the react versions.',
  isLikelyFlaky: false,
  confidence: 0.85,
};

function recorder(responses: unknown[]): { complete: CompletionFn; calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  const complete: CompletionFn = (request) => {
    calls.push(request);
    const data = responses[calls.length - 1];
    const raw: RawCompletion = { data, inputTokens: 1_000, outputTokens: 200 };
    return Promise.resolve(raw);
  };
  return { complete, calls };
}

const context = { provider: 'anthropic', model: 'claude-opus-5' } as const;

describe('analyzeWithProvider', () => {
  it('returns the validated result on the first attempt', async () => {
    const { complete, calls } = recorder([valid]);

    const analysis = await analyzeWithProvider(complete, input, context);

    expect(analysis.result).toEqual(valid);
    expect(analysis.attempts).toBe(1);
    expect(analysis.fellBack).toBe(false);
    expect(analysis.promptVersion).toBe(PROMPT_VERSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.repair).toBeUndefined();
  });

  it('tracks tokens, cost and latency', async () => {
    const { complete } = recorder([valid]);

    const analysis = await analyzeWithProvider(complete, input, context);

    expect(analysis.usage.inputTokens).toBe(1_000);
    expect(analysis.usage.outputTokens).toBe(200);
    // 1000 in at $5/MTok + 200 out at $25/MTok
    expect(analysis.usage.costUsd).toBeCloseTo(0.005 + 0.005, 6);
    expect(analysis.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('retries once with the validation error, then succeeds', async () => {
    const { complete, calls } = recorder([{ category: 'nope', title: 'x' }, valid]);

    const analysis = await analyzeWithProvider(complete, input, context);

    expect(analysis.attempts).toBe(2);
    expect(analysis.fellBack).toBe(false);
    expect(analysis.result).toEqual(valid);
    expect(calls[1]?.repair).toContain('category');
    // Tokens from both attempts are billed.
    expect(analysis.usage.inputTokens).toBe(2_000);
  });

  it('falls back to an unknown analysis after a second invalid answer', async () => {
    const { complete } = recorder(['not json at all', { confidence: 5 }]);

    const analysis = await analyzeWithProvider(complete, input, context);

    expect(analysis.fellBack).toBe(true);
    expect(analysis.result.category).toBe('unknown');
    expect(analysis.result.confidence).toBe(0);
    expect(analysis.attempts).toBe(2);
  });

  it('reports no cost for an unknown model and zero for local models', async () => {
    const { complete } = recorder([valid, valid]);

    const unknown = await analyzeWithProvider(complete, input, {
      provider: 'anthropic',
      model: 'some-unreleased-model',
    });
    const local = await analyzeWithProvider(complete, input, {
      provider: 'ollama',
      model: 'llama3',
    });

    expect(unknown.usage.costUsd).toBeNull();
    expect(local.usage.costUsd).toBe(0);
  });

  it('sends the excerpt and job context in the prompt', async () => {
    const { complete, calls } = recorder([valid]);

    await analyzeWithProvider(complete, input, context);

    expect(calls[0]?.user).toContain('acme/api');
    expect(calls[0]?.user).toContain('npm ci');
    expect(calls[0]?.user).toContain('npm ERR! ERESOLVE');
    expect(calls[0]?.system).toContain('Never invent file paths');
  });
});

describe('fallbackResult', () => {
  it('is a valid, honest, low-confidence analysis', () => {
    const result = fallbackResult('the model timed out');
    expect(result.confidence).toBe(0);
    expect(result.category).toBe('unknown');
    expect(result.rootCause).toContain('the model timed out');
  });
});
