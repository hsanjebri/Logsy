import type { AnalysisResult } from '@logsy/core';

/** Everything the model is given about a failure. */
export interface AnalysisInput {
  /** Redacted, trimmed log excerpt. */
  excerpt: string;
  repoFullName: string;
  workflowName: string;
  jobName: string;
  stepName: string | null;
  /** Summary of the PR diff: file names and a few stats, never the full patch. */
  diffSummary?: string;
  /** The workflow file, when it is small enough to help. */
  workflowFile?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache, when reported. */
  cachedInputTokens?: number;
  /** Estimated from the model's published price; null when the model is unknown. */
  costUsd: number | null;
}

export interface LlmAnalysis {
  result: AnalysisResult;
  usage: Usage;
  latencyMs: number;
  model: string;
  promptVersion: string;
  /** How many model calls it took, counting a retry after invalid output. */
  attempts: number;
  /** True when the model never returned a valid result and a placeholder is returned. */
  fellBack: boolean;
}

/** A single model backend. */
export type SingleProviderName = 'anthropic' | 'openai' | 'ollama' | 'groq' | 'gemini';

/** `panel` is several single providers asked the same question; see panel.ts. */
export type ProviderName = SingleProviderName | 'panel';

export interface LlmProvider {
  readonly name: ProviderName;
  readonly model: string;
  analyze(input: AnalysisInput): Promise<LlmAnalysis>;
}

/** One raw model call: the parsed JSON it returned, plus what it cost. */
export interface RawCompletion {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface CompletionRequest {
  system: string;
  user: string;
  /** Present on a retry: what was wrong with the previous answer. */
  repair?: string;
}

/** What each adapter implements; validation and retries are shared. */
export type CompletionFn = (request: CompletionRequest) => Promise<RawCompletion>;
