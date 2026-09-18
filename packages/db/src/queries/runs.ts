import { eq } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { failures, repositories, workflowRuns } from '../schema.js';
import type { FailureCategory } from '@logsy/core';

export interface WorkflowRunInput {
  repositoryId: number;
  githubRunId: number;
  runAttempt: number;
  workflowName: string;
  headSha: string;
  headBranch: string | null;
  event: string;
  conclusion: string | null;
  prNumber: number | null;
  htmlUrl: string;
}

export interface FailureInput {
  workflowRunId: number;
  githubJobId: number;
  jobName: string;
  stepName: string | null;
  category?: FailureCategory;
  fingerprint: string;
  /** Must already be redacted. */
  errorExcerpt: string;
  logCharsOriginal: number;
  logCharsTrimmed: number;
}

export async function findRepositoryByGithubId(db: Executor, githubRepoId: number) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.githubRepoId, githubRepoId))
    .limit(1);
  return row;
}

/** Inserts the run or refreshes it if the same attempt is analyzed again. */
export async function upsertWorkflowRun(db: Executor, input: WorkflowRunInput): Promise<number> {
  const [row] = await db
    .insert(workflowRuns)
    .values(input)
    .onConflictDoUpdate({
      target: [workflowRuns.githubRunId, workflowRuns.runAttempt],
      set: {
        conclusion: input.conclusion,
        prNumber: input.prNumber,
        workflowName: input.workflowName,
        headBranch: input.headBranch,
      },
    })
    .returning({ id: workflowRuns.id });
  if (!row) throw new Error('upsertWorkflowRun returned no row');
  return row.id;
}

/** One row per failed job of a run attempt; re-analysis overwrites the previous result. */
export async function upsertFailure(db: Executor, input: FailureInput): Promise<number> {
  const [row] = await db
    .insert(failures)
    .values(input)
    .onConflictDoUpdate({
      target: [failures.workflowRunId, failures.githubJobId],
      set: {
        jobName: input.jobName,
        stepName: input.stepName,
        category: input.category ?? 'unknown',
        fingerprint: input.fingerprint,
        errorExcerpt: input.errorExcerpt,
        logCharsOriginal: input.logCharsOriginal,
        logCharsTrimmed: input.logCharsTrimmed,
      },
    })
    .returning({ id: failures.id });
  if (!row) throw new Error('upsertFailure returned no row');
  return row.id;
}
