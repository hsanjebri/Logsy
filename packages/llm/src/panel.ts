import { MIN_COMMENT_CONFIDENCE, type AnalysisResult, type LikelyFile } from '@logsy/core';
import type { AnalysisInput, LlmAnalysis, LlmProvider, Usage } from './types.js';

export interface PanelOptions {
  /** Asked the same question in parallel; at least two. */
  members: readonly LlmProvider[];
}

/**
 * When the panel splits, confidence is capped below the comment threshold, so the
 * comment shows the error excerpt instead of a cause two models could not agree on.
 */
export const DISAGREEMENT_CONFIDENCE = MIN_COMMENT_CONFIDENCE - 0.1;

const MAX_EVIDENCE = 5;
const MAX_LIKELY_FILES = 10;

/**
 * Several models analyze the same failure independently. Agreement on the category
 * is a real confidence signal; disagreement means "unsure", and a member that errors
 * (a free-tier rate limit, an outage) is simply outvoted by the ones that answered.
 * Members run in parallel, so latency is the slowest member's, not the sum.
 */
export function createPanelProvider(options: PanelOptions): LlmProvider {
  if (options.members.length < 2) {
    throw new Error('a panel needs at least two members');
  }
  const model = `panel(${options.members.map((member) => `${member.name}:${member.model}`).join(', ')})`;

  return {
    name: 'panel',
    model,
    analyze: async (input: AnalysisInput): Promise<LlmAnalysis> => {
      const startedAt = Date.now();
      const settled = await Promise.allSettled(
        options.members.map((member) => member.analyze(input)),
      );
      const answers = settled.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value] : [],
      );
      if (answers.length === 0) {
        // Nobody answered: surface the error so the job retries, like a single provider.
        const first = settled.find((outcome) => outcome.status === 'rejected');
        throw first?.reason instanceof Error
          ? first.reason
          : new Error('every panel member failed');
      }
      return { ...combinePanel(answers), latencyMs: Date.now() - startedAt };
    },
  };
}

/** Merges the members' answers into one; pure, so the voting rules are testable. */
export function combinePanel(answers: readonly LlmAnalysis[]): LlmAnalysis {
  const first = answers[0];
  if (!first) throw new Error('combinePanel needs at least one answer');

  const usage = sumUsage(answers);
  const attempts = answers.reduce((total, answer) => total + answer.attempts, 0);
  const latencyMs = Math.max(...answers.map((answer) => answer.latencyMs));
  const valid = answers.filter((answer) => !answer.fellBack);

  if (valid.length === 0) {
    return { ...first, usage, attempts, latencyMs, model: modelsOf(answers) };
  }

  const majority = majorityCategory(valid);
  const byConfidence = [...valid].sort((a, b) => b.result.confidence - a.result.confidence);

  if (majority === undefined) {
    // No category has most of the votes: keep the strongest answer, but as a guess.
    const base = byConfidence[0] ?? first;
    return {
      ...base,
      result: {
        ...base.result,
        confidence: Math.min(base.result.confidence, DISAGREEMENT_CONFIDENCE),
      },
      usage,
      attempts,
      latencyMs,
      model: modelsOf(valid),
    };
  }

  const agreeing = byConfidence.filter((answer) => answer.result.category === majority);
  const base = agreeing[0] ?? first;
  return {
    ...base,
    result: mergeResults(
      base.result,
      agreeing.slice(1).map((answer) => answer.result),
    ),
    usage,
    attempts,
    latencyMs,
    model: modelsOf(valid),
  };
}

/** The category more than half of the valid answers chose, if any. */
function majorityCategory(answers: readonly LlmAnalysis[]): AnalysisResult['category'] | undefined {
  const votes = new Map<AnalysisResult['category'], number>();
  for (const answer of answers) {
    votes.set(answer.result.category, (votes.get(answer.result.category) ?? 0) + 1);
  }
  for (const [category, count] of votes) {
    if (count * 2 > answers.length) return category;
  }
  return undefined;
}

/** Keeps the strongest answer's wording and adds what the others found. */
function mergeResults(base: AnalysisResult, others: readonly AnalysisResult[]): AnalysisResult {
  const evidence = [...new Set([base, ...others].flatMap((result) => result.evidence))].slice(
    0,
    MAX_EVIDENCE,
  );

  const files = new Map<string, LikelyFile>();
  for (const file of [base, ...others].flatMap((result) => result.likelyFiles)) {
    if (!files.has(file.path)) files.set(file.path, file);
  }

  return {
    ...base,
    evidence,
    likelyFiles: [...files.values()].slice(0, MAX_LIKELY_FILES),
  };
}

function sumUsage(answers: readonly LlmAnalysis[]): Usage {
  const costs = answers.map((answer) => answer.usage.costUsd);
  return {
    inputTokens: answers.reduce((total, answer) => total + answer.usage.inputTokens, 0),
    outputTokens: answers.reduce((total, answer) => total + answer.usage.outputTokens, 0),
    cachedInputTokens: answers.reduce(
      (total, answer) => total + (answer.usage.cachedInputTokens ?? 0),
      0,
    ),
    // A partial sum would understate the cost; unknown stays unknown.
    costUsd: costs.some((cost) => cost === null)
      ? null
      : costs.reduce<number>((total, cost) => total + (cost ?? 0), 0),
  };
}

function modelsOf(answers: readonly LlmAnalysis[]): string {
  return answers.map((answer) => answer.model).join(' + ');
}
