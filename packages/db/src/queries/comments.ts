import type { AnalysisResult, FailureCategory } from '@logsy/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { analyses, failures, prComments, workflowRuns } from '../schema.js';

export interface PrCommentInput {
  repositoryId: number;
  prNumber: number;
  githubCommentId: number;
  lastRunId: number | null;
}

/** The comment Logsy already posted on this pull request, if any. */
export async function findPrComment(db: Executor, repositoryId: number, prNumber: number) {
  const [row] = await db
    .select()
    .from(prComments)
    .where(and(eq(prComments.repositoryId, repositoryId), eq(prComments.prNumber, prNumber)))
    .limit(1);
  return row;
}

/** One row per pull request; re-posting updates it rather than adding another. */
export async function upsertPrComment(db: Executor, input: PrCommentInput): Promise<void> {
  await db
    .insert(prComments)
    .values(input)
    .onConflictDoUpdate({
      target: [prComments.repositoryId, prComments.prNumber],
      set: {
        githubCommentId: input.githubCommentId,
        lastRunId: input.lastRunId,
        updatedAt: sql`now()`,
      },
    });
}

export interface FailureWithAnalysis {
  failureId: number;
  jobName: string;
  stepName: string | null;
  category: FailureCategory;
  fingerprint: string;
  errorExcerpt: string;
  analysisId: number | null;
  result: AnalysisResult | null;
  source: 'rule' | 'llm' | 'cache' | null;
  model: string | null;
  confidence: number | null;
}

/**
 * Everything needed to write the comment for a run: each failed job with its most
 * recent analysis, if one was produced.
 */
export async function findRunFailures(
  db: Executor,
  workflowRunId: number,
): Promise<FailureWithAnalysis[]> {
  const rows = await db
    .select({
      failureId: failures.id,
      jobName: failures.jobName,
      stepName: failures.stepName,
      category: failures.category,
      fingerprint: failures.fingerprint,
      errorExcerpt: failures.errorExcerpt,
      analysisId: analyses.id,
      result: analyses.result,
      source: analyses.source,
      model: analyses.model,
      confidence: analyses.confidence,
      createdAt: analyses.createdAt,
    })
    .from(failures)
    .leftJoin(analyses, eq(analyses.failureId, failures.id))
    .where(eq(failures.workflowRunId, workflowRunId))
    .orderBy(failures.id, desc(analyses.createdAt));

  // The join returns one row per analysis; keep the newest per failure.
  const byFailure = new Map<number, FailureWithAnalysis>();
  for (const row of rows) {
    if (byFailure.has(row.failureId)) continue;
    byFailure.set(row.failureId, {
      failureId: row.failureId,
      jobName: row.jobName,
      stepName: row.stepName,
      category: row.category,
      fingerprint: row.fingerprint,
      errorExcerpt: row.errorExcerpt,
      analysisId: row.analysisId,
      result: row.result as AnalysisResult | null,
      source: row.source,
      model: row.model,
      confidence: row.confidence,
    });
  }
  return [...byFailure.values()];
}

/** The stored run, by GitHub's run id and attempt. */
export async function findWorkflowRun(db: Executor, githubRunId: number, runAttempt: number) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.githubRunId, githubRunId), eq(workflowRuns.runAttempt, runAttempt)))
    .limit(1);
  return row;
}
