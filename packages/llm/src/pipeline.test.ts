import type { AnalysisResult } from '@logsy/core';
import { describe, expect, it } from 'vitest';
import { analyzeLog } from './pipeline.js';
import type { AnalysisInput, LlmProvider } from './types.js';

const RULE_LOG = [
  '##[group]Run npm ci',
  'npm ci',
  'npm ERR! code ERESOLVE',
  'npm ERR! ERESOLVE unable to resolve dependency tree',
  '##[error]Process completed with exit code 1.',
].join('\n');

const UNKNOWN_LOG = [
  '##[group]Run ./deploy.sh',
  './deploy.sh',
  'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'something odd happened in the frobnicator',
  '##[error]Process completed with exit code 3.',
].join('\n');

const modelResult: AnalysisResult = {
  category: 'configuration',
  title: 'The deploy script failed',
  rootCause: 'The frobnicator rejected its configuration.',
  evidence: ['something odd happened in the frobnicator'],
  likelyFiles: [],
  suggestedFix: 'Check the frobnicator settings.',
  isLikelyFlaky: false,
  confidence: 0.8,
};

function fakeLlm(seen: AnalysisInput[] = []): LlmProvider {
  return {
    name: 'groq',
    model: 'test-model',
    analyze: (input) => {
      seen.push(input);
      return Promise.resolve({
        result: modelResult,
        usage: { inputTokens: 300, outputTokens: 80, costUsd: null },
        latencyMs: 1_200,
        model: 'test-model',
        promptVersion: 'v1',
        attempts: 1,
        fellBack: false,
      });
    },
  };
}

describe('analyzeLog', () => {
  it('uses a rule when one matches, without asking the LLM', async () => {
    const seen: AnalysisInput[] = [];
    const result = await analyzeLog(RULE_LOG, { llm: fakeLlm(seen) });

    expect(result.source).toBe('rule');
    expect(result.ruleId).not.toBeNull();
    expect(result.analysis.category).toBe('dependency_error');
    expect(seen).toHaveLength(0);
    expect(result.comment).not.toContain('<!-- logsy:comment -->');
  });

  it('asks the LLM when no rule matches, with a redacted excerpt', async () => {
    const seen: AnalysisInput[] = [];
    const result = await analyzeLog(UNKNOWN_LOG, { llm: fakeLlm(seen), jobName: 'deploy' });

    expect(result.source).toBe('llm');
    expect(result.llm).toMatchObject({ model: 'test-model', latencyMs: 1_200, fellBack: false });
    expect(result.comment).toContain('The deploy script failed');
    expect(seen[0]?.jobName).toBe('deploy');
    expect(seen[0]?.excerpt).not.toContain('ghp_');
    expect(result.redactions).toBeGreaterThan(0);
  });

  it('can skip the rules to show what the model says', async () => {
    const seen: AnalysisInput[] = [];
    const result = await analyzeLog(RULE_LOG, { llm: fakeLlm(seen), skipRules: true });

    expect(result.source).toBe('llm');
    expect(seen).toHaveLength(1);
  });

  it('falls back to the excerpt when nothing can explain the failure', async () => {
    const result = await analyzeLog(UNKNOWN_LOG);

    expect(result.source).toBe('none');
    expect(result.analysis.confidence).toBe(0);
    expect(result.comment).toContain('### CI failed');
    expect(result.comment).toContain('frobnicator');
  });

  it('gives the same fingerprint to the same failure', async () => {
    const first = await analyzeLog(RULE_LOG);
    const second = await analyzeLog(RULE_LOG);
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
