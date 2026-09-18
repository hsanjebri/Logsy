import {
  createDatabase,
  failures,
  upsertInstallation,
  upsertRepositories,
  workflowRuns,
} from '@logsy/db';
import { truncateAll } from '@logsy/db/testing';
import type { AnalyzeRunJob } from '@logsy/queue';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { processAnalyzeRun } from './analyze-run.js';
import { githubStub, workflowJob } from './test/github-stub.js';

const { db, pool } = createDatabase(inject('databaseUrl'));
const log = pino({ level: 'silent' });

afterAll(() => pool.end());

const GITHUB_REPO_ID = 900_000_001;

const job: AnalyzeRunJob = {
  installationId: 51_234_567,
  githubRepoId: GITHUB_REPO_ID,
  owner: 'acme',
  repo: 'api',
  runId: 42_000_000_000,
  runAttempt: 1,
  workflowName: 'CI',
  headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
  headBranch: 'feat/queue',
  event: 'pull_request',
  conclusion: 'failure',
  htmlUrl: 'https://github.com/acme/api/actions/runs/42000000000',
  prNumbers: [7],
};

const failingLog = [
  '##[group]Run npm test',
  'export NPM_TOKEN=npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
  'FAIL src/server.test.ts',
  '##[error]Process completed with exit code 1.',
].join('\n');

beforeEach(async () => {
  await truncateAll(db);
  const installationId = await upsertInstallation(db, {
    githubInstallationId: job.installationId,
    accountLogin: 'acme',
    accountType: 'Organization',
  });
  await upsertRepositories(db, installationId, [
    { githubRepoId: GITHUB_REPO_ID, fullName: 'acme/api', private: false },
  ]);
});

describe('processAnalyzeRun', () => {
  it('stores the run and one redacted failure per failed job', async () => {
    const github = githubStub({
      jobs: [
        workflowJob({ id: 101, name: 'build', conclusion: 'success' }),
        workflowJob({ id: 102, name: 'test (22)' }),
      ],
      logs: { 102: failingLog },
    });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'analyzed', failedJobs: 1 });
    expect(github.downloadedJobIds).toEqual([102]);

    const [run] = await db.select().from(workflowRuns);
    expect(run).toMatchObject({
      githubRunId: job.runId,
      runAttempt: 1,
      workflowName: 'CI',
      prNumber: 7,
      conclusion: 'failure',
    });

    const stored = await db.select().from(failures);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      githubJobId: 102,
      jobName: 'test (22)',
      stepName: 'Run tests',
      category: 'unknown',
      logCharsOriginal: failingLog.length,
      workflowRunId: run?.id,
    });
    expect(stored[0]?.errorExcerpt).toContain('##[error]Process completed with exit code 1.');
    expect(stored[0]?.errorExcerpt).not.toContain('npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ');
    expect(stored[0]?.errorExcerpt).toContain('[REDACTED:npm_token]');
  });

  it('is idempotent for the same run attempt', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: failingLog } });

    await processAnalyzeRun({ db, github, log }, job);
    await processAnalyzeRun({ db, github, log }, job);

    expect(await db.select().from(workflowRuns)).toHaveLength(1);
    expect(await db.select().from(failures)).toHaveLength(1);
  });

  it('stores the run but no failures when no job reports a failure', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 101, conclusion: 'cancelled' })] });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result.status).toBe('no-failed-jobs');
    expect(await db.select().from(workflowRuns)).toHaveLength(1);
    expect(await db.select().from(failures)).toHaveLength(0);
  });

  it('still records a failure when the logs are gone', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], missingLogs: [102] });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'analyzed', failedJobs: 1, logChars: 0 });
    const [stored] = await db.select().from(failures);
    expect(stored).toMatchObject({ githubJobId: 102, logCharsOriginal: 0, errorExcerpt: '' });
  });

  it('drops the job when the repository is not installed', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })] });

    const result = await processAnalyzeRun({ db, github, log }, { ...job, githubRepoId: 123 });

    expect(result.status).toBe('unknown-repository');
    expect(await db.select().from(workflowRuns)).toHaveLength(0);
  });

  it('defers the run when the GitHub rate limit is nearly exhausted', async () => {
    const resetAt = new Date('2026-09-18T12:00:00Z');
    const github = githubStub({
      jobs: [workflowJob({ id: 102 })],
      logs: { 102: failingLog },
      rateLimit: { limit: 5000, remaining: 3, resetAt },
    });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result.retryAt).toEqual(resetAt);
    expect(github.downloadedJobIds).toEqual([]);
    expect(await db.select().from(failures)).toHaveLength(0);
  });
});
