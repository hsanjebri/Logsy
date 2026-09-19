import type { AnalysisResult } from '@logsy/core';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { analyses, failures, workflowRuns } from '../schema.js';

export interface AnalysisInput {
  failureId: number;
  fingerprint: string;
  source: 'rule' | 'llm' | 'cache';
  result: AnalysisResult;
  confidence: number;
  ruleId?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
}

export async function insertAnalysis(db: Executor, input: AnalysisInput): Promise<number> {
  const [row] = await db
    .insert(analyses)
    .values({
      failureId: input.failureId,
      fingerprint: input.fingerprint,
      source: input.source,
      ruleId: input.ruleId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      result: input.result,
      confidence: input.confidence,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      costUsd: input.costUsd === undefined || input.costUsd === null ? null : String(input.costUsd),
      latencyMs: input.latencyMs ?? null,
    })
    .returning({ id: analyses.id });
  if (!row) throw new Error('insertAnalysis returned no row');
  return row.id;
}

export interface CacheLookupOptions {
  /** Ignore analyses below this confidence. */
  minConfidence?: number;
  /** Ignore analyses older than this. */
  maxAgeDays?: number;
}

export interface CachedAnalysis {
  id: number;
  result: AnalysisResult;
  confidence: number;
  source: 'rule' | 'llm' | 'cache';
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
}

/**
 * The newest good analysis for a fingerprint, so an identical failure is explained
 * without paying for another LLM call. Cache entries are not reused, only originals.
 */
export async function findCachedAnalysis(
  db: Executor,
  fingerprintValue: string,
  options: CacheLookupOptions = {},
): Promise<CachedAnalysis | undefined> {
  const minConfidence = options.minConfidence ?? 0.5;
  const maxAgeDays = options.maxAgeDays ?? 90;

  const [row] = await db
    .select({
      id: analyses.id,
      result: analyses.result,
      confidence: analyses.confidence,
      source: analyses.source,
      model: analyses.model,
      promptVersion: analyses.promptVersion,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .where(
      and(
        eq(analyses.fingerprint, fingerprintValue),
        gte(analyses.confidence, minConfidence),
        inArray(analyses.source, ['rule', 'llm']),
        gte(analyses.createdAt, sql`now() - make_interval(days => ${maxAgeDays})`),
      ),
    )
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!row) return undefined;
  return { ...row, result: row.result as unknown as AnalysisResult };
}

/** How often this fingerprint has been seen in a repository; drives "seen N times". */
export async function countFailuresByFingerprint(
  db: Executor,
  repositoryId: number,
  fingerprintValue: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(failures)
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(
      and(eq(workflowRuns.repositoryId, repositoryId), eq(failures.fingerprint, fingerprintValue)),
    );
  return row?.total ?? 0;
}
