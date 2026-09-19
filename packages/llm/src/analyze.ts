import { analysisResultSchema, type AnalysisResult } from '@logsy/core';
import { z } from 'zod';
import { estimateCostUsd } from './pricing.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildRepairMessage, buildUserMessage } from './prompt.js';
import type { AnalysisInput, CompletionFn, LlmAnalysis, ProviderName } from './types.js';

/** Returned when the model cannot produce a valid answer; the comment stays factual. */
export function fallbackResult(reason: string): AnalysisResult {
  return {
    category: 'unknown',
    title: 'Could not determine the cause automatically',
    rootCause: `Logsy could not analyze this failure (${reason}). The error excerpt is shown above.`,
    evidence: [],
    likelyFiles: [],
    suggestedFix: 'Read the log excerpt; the failing step and its output are quoted above.',
    isLikelyFlaky: false,
    confidence: 0,
  };
}

/**
 * Runs one analysis: validate the model's JSON, retry once telling it what was wrong,
 * then fall back rather than storing something malformed.
 */
export async function analyzeWithProvider(
  complete: CompletionFn,
  input: AnalysisInput,
  context: { provider: ProviderName; model: string },
): Promise<LlmAnalysis> {
  const startedAt = Date.now();
  const user = buildUserMessage(input);

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let lastIssues = 'no answer';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await complete({
      system: SYSTEM_PROMPT,
      user,
      repair: attempt === 1 ? undefined : buildRepairMessage(lastIssues),
    });

    inputTokens += raw.inputTokens;
    outputTokens += raw.outputTokens;
    cachedInputTokens += raw.cachedInputTokens ?? 0;

    const parsed = analysisResultSchema.safeParse(raw.data);
    if (parsed.success) {
      return {
        result: parsed.data,
        usage: usageOf(context, inputTokens, outputTokens, cachedInputTokens),
        latencyMs: Date.now() - startedAt,
        model: context.model,
        promptVersion: PROMPT_VERSION,
        attempts: attempt,
        fellBack: false,
      };
    }
    lastIssues = z.prettifyError(parsed.error);
  }

  return {
    result: fallbackResult('the model did not return a valid result'),
    usage: usageOf(context, inputTokens, outputTokens, cachedInputTokens),
    latencyMs: Date.now() - startedAt,
    model: context.model,
    promptVersion: PROMPT_VERSION,
    attempts: 2,
    fellBack: true,
  };
}

function usageOf(
  context: { provider: ProviderName; model: string },
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
) {
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd: estimateCostUsd(context.model, inputTokens, outputTokens, context.provider),
  };
}
