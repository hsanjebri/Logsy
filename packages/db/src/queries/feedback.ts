import { and, count, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { analyses, failures, feedback, workflowRuns } from '../schema.js';

export type Verdict = 'helpful' | 'wrong';

export interface FeedbackInput {
  analysisId: number;
  githubUser: string;
  verdict: Verdict;
  note?: string | null;
}

/** One vote per person per analysis; voting again replaces the earlier verdict. */
export async function recordFeedback(db: Executor, input: FeedbackInput): Promise<void> {
  await db
    .insert(feedback)
    .values({
      analysisId: input.analysisId,
      githubUser: input.githubUser,
      verdict: input.verdict,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [feedback.analysisId, feedback.githubUser],
      set: { verdict: input.verdict, note: input.note ?? null, createdAt: sql`now()` },
    });
}

/** The analysis a feedback link refers to, with the repository that owns it. */
export async function findAnalysisOwner(db: Executor, analysisId: number) {
  const [row] = await db
    .select({
      analysisId: analyses.id,
      repositoryId: workflowRuns.repositoryId,
      title: sql<string | null>`${analyses.result} ->> 'title'`,
    })
    .from(analyses)
    .innerJoin(failures, eq(failures.id, analyses.failureId))
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(eq(analyses.id, analysisId))
    .limit(1);
  return row;
}

export interface FeedbackStats {
  helpful: number;
  wrong: number;
}

/** How the analyses of one repository have been judged. */
export async function getFeedbackStats(db: Executor, repositoryId: number): Promise<FeedbackStats> {
  const rows = await db
    .select({ verdict: feedback.verdict, total: count() })
    .from(feedback)
    .innerJoin(analyses, eq(analyses.id, feedback.analysisId))
    .innerJoin(failures, eq(failures.id, analyses.failureId))
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(eq(workflowRuns.repositoryId, repositoryId))
    .groupBy(feedback.verdict);

  const stats: FeedbackStats = { helpful: 0, wrong: 0 };
  for (const row of rows) stats[row.verdict] = row.total;
  return stats;
}

/** This person's existing verdict on an analysis, so the page can show it back. */
export async function findFeedback(db: Executor, analysisId: number, githubUser: string) {
  const [row] = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.analysisId, analysisId), eq(feedback.githubUser, githubUser)))
    .limit(1);
  return row;
}
