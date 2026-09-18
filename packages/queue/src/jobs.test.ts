import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, analyzeRunJobId, analyzeRunJobSchema } from './jobs.js';

const job = {
  installationId: 51_234_567,
  githubRepoId: 900_000_001,
  owner: 'hsanjebri',
  repo: 'api',
  runId: 42_000_000_000,
  runAttempt: 1,
  workflowName: 'CI',
  headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
  headBranch: 'feat/logsy',
  event: 'pull_request',
  conclusion: 'failure',
  htmlUrl: 'https://github.com/hsanjebri/api/actions/runs/42000000000',
  prNumbers: [7],
};

describe('analyze-run job payload', () => {
  it('accepts a full payload', () => {
    expect(analyzeRunJobSchema.parse(job)).toEqual(job);
  });

  it('allows a missing branch but requires the run identity', () => {
    expect(analyzeRunJobSchema.parse({ ...job, headBranch: null }).headBranch).toBeNull();
    expect(analyzeRunJobSchema.safeParse({ ...job, runId: 0 }).success).toBe(false);
    expect(analyzeRunJobSchema.safeParse({ ...job, htmlUrl: 'not-a-url' }).success).toBe(false);
    expect(analyzeRunJobSchema.safeParse({ ...job, prNumbers: undefined }).success).toBe(false);
  });

  it('derives a stable job id per run attempt', () => {
    expect(analyzeRunJobId(job)).toBe('run-42000000000-attempt-1');
    expect(analyzeRunJobId({ ...job, runAttempt: 2 })).not.toBe(analyzeRunJobId(job));
  });

  it('keeps queue names stable', () => {
    expect(QUEUE_NAMES).toEqual({
      analyzeRun: 'analyze-run',
      postComment: 'post-comment',
      testReport: 'test-report',
    });
  });
});
