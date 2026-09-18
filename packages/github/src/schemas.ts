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

/** The step that failed, if GitHub reported one. */
export function failedStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps?.find((step) => step.conclusion === 'failure');
}

export function isFailedJob(job: WorkflowJob): boolean {
  return job.conclusion === 'failure';
}
