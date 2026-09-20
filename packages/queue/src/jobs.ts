import { z } from 'zod';

/** Queue names. Kept in one place so the server and worker can never disagree. */
export const QUEUE_NAMES = {
  analyzeRun: 'analyze-run',
  postComment: 'post-comment',
  testReport: 'test-report',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Everything the worker needs about a failed workflow run, straight from the webhook. */
export const analyzeRunJobSchema = z.object({
  installationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  workflowName: z.string().min(1),
  headSha: z.string().min(1),
  headBranch: z.string().nullable(),
  event: z.string().min(1),
  conclusion: z.string().min(1),
  htmlUrl: z.url(),
  prNumbers: z.array(z.number().int().positive()),
});

export type AnalyzeRunJob = z.infer<typeof analyzeRunJobSchema>;

/**
 * One job per run attempt. BullMQ ignores a job whose id already exists, so a
 * duplicate webhook can never queue the same analysis twice.
 */
export function analyzeRunJobId(job: Pick<AnalyzeRunJob, 'runId' | 'runAttempt'>): string {
  return `run-${job.runId}-attempt-${job.runAttempt}`;
}

/** Posting or updating the single PR comment for a run. */
export const postCommentJobSchema = z.object({
  installationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  runId: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  workflowName: z.string().min(1),
  headSha: z.string().min(1),
  htmlUrl: z.url(),
  prNumbers: z.array(z.number().int().positive()),
  /** `resolved` replaces the failure comment with the passing state. */
  mode: z.enum(['failure', 'resolved']).default('failure'),
});

export type PostCommentJob = z.infer<typeof postCommentJobSchema>;

/** One comment job per run attempt and mode. */
export function postCommentJobId(job: PostCommentJob): string {
  return `comment-${job.runId}-attempt-${job.runAttempt}-${job.mode}`;
}
