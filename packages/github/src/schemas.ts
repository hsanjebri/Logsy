import { z } from 'zod';

/** API responses are external input, so only the fields Logsy uses are declared and validated. */

export const workflowStepSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  number: z.number().int(),
});

export const workflowJobSchema = z.object({
  id: z.number().int().positive(),
  run_id: z.number().int().positive(),
  run_attempt: z.number().int().positive().optional(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  steps: z.array(workflowStepSchema).optional(),
});

export const listJobsResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  jobs: z.array(workflowJobSchema),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowJob = z.infer<typeof workflowJobSchema>;

export const pullRequestRefSchema = z.object({
  number: z.number().int().positive(),
  state: z.string().optional(),
  draft: z.boolean().optional(),
});

export const listPullsResponseSchema = z.array(pullRequestRefSchema);

export const issueCommentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string().nullable(),
  user: z.object({ login: z.string(), type: z.string().optional() }).nullable(),
});

export const listCommentsResponseSchema = z.array(issueCommentSchema);

export const pullRequestFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const listPullFilesResponseSchema = z.array(pullRequestFileSchema);

export type PullRequestRef = z.infer<typeof pullRequestRefSchema>;
export type IssueComment = z.infer<typeof issueCommentSchema>;
export type PullRequestFile = z.infer<typeof pullRequestFileSchema>;

/** The step that failed, if GitHub reported one. */
export function failedStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps?.find((step) => step.conclusion === 'failure');
}

export function isFailedJob(job: WorkflowJob): boolean {
  return job.conclusion === 'failure';
}

/** Only the field Logsy needs: which check run to update. */
export const checkRunsResponseSchema = z.object({
  check_runs: z.array(z.object({ id: z.number().int().positive() })),
});

/** What a check run carries: the heading people see, and the inline annotations. */
export const checkRunOutputSchema = z.object({
  title: z.string().min(1).max(255),
  summary: z.string().min(1).max(65_535),
  text: z.string().max(65_535).optional(),
  annotations: z
    .array(
      z.object({
        path: z.string().min(1),
        start_line: z.number().int().positive(),
        end_line: z.number().int().positive(),
        annotation_level: z.enum(['notice', 'warning', 'failure']),
        title: z.string().min(1).max(255),
        message: z.string().min(1),
      }),
    )
    .max(50)
    .optional(),
});

export type CheckRunOutput = z.infer<typeof checkRunOutputSchema>;

export interface CheckRunInput {
  /** Omitted to create one, given to update the existing one. */
  checkRunId?: number;
  name: string;
  headSha: string;
  /** Logsy explains, it never blocks: `neutral` keeps the check from failing a PR. */
  conclusion: 'neutral' | 'success' | 'failure';
  output: CheckRunOutput;
}
