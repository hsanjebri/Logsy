import {
  analyses,
  createDatabase,
  failures,
  repositories,
  upsertInstallation,
  upsertRepositories,
  workflowRuns,
} from '@logsy/db';
import { truncateAll } from '@logsy/db/testing';
import type { AnalysisInput, LlmAnalysis, LlmProvider } from '@logsy/llm';
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
      // "FAIL src/server.test.ts" is recognized by the JS test rule.
      category: 'test_failure',
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

describe('fingerprinting, cache and rules', () => {
  const eresolveLog = [
    '##[group]Run npm ci',
    'npm ci',
    '##[endgroup]',
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE unable to resolve dependency tree',
    'npm ERR! Found: react@18.2.0',
    '##[error]Process completed with exit code 1.',
  ].join('\n');

  it('resolves a known pattern with a rule and no LLM call', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: eresolveLog } });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result.analyses).toEqual(['rule']);
    const [failure] = await db.select().from(failures);
    expect(failure?.category).toBe('dependency_error');
    expect(failure?.fingerprint).toMatch(/^v1:[0-9a-f]{32}$/);

    const [analysis] = await db.select().from(analyses);
    expect(analysis).toMatchObject({ source: 'rule', ruleId: 'npm-eresolve', model: null });
    expect(analysis?.result).toMatchObject({ category: 'dependency_error' });
  });

  it('reuses the stored analysis when the same failure happens again', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: eresolveLog } });
    await processAnalyzeRun({ db, github, log }, job);

    // A later run of the same failure: different run and job ids, same error.
    const second = await processAnalyzeRun(
      {
        db,
        github: githubStub({ jobs: [workflowJob({ id: 555 })], logs: { 555: eresolveLog } }),
        log,
      },
      { ...job, runId: job.runId + 1, runAttempt: 1 },
    );

    expect(second.analyses).toEqual(['cache']);
    const stored = await db.select().from(analyses).orderBy(analyses.id);
    expect(stored.map((row) => row.source)).toEqual(['rule', 'cache']);
    // Both rows describe the same failure.
    const fingerprints = new Set(stored.map((row) => row.fingerprint));
    expect(fingerprints.size).toBe(1);
  });

  it('gives the same fingerprint to the same error in different runs', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: eresolveLog } });
    await processAnalyzeRun({ db, github, log }, job);
    await processAnalyzeRun(
      {
        db,
        github: githubStub({ jobs: [workflowJob({ id: 777 })], logs: { 777: eresolveLog } }),
        log,
      },
      { ...job, runId: job.runId + 2 },
    );

    const stored = await db.select().from(failures);
    expect(new Set(stored.map((row) => row.fingerprint)).size).toBe(1);
  });

  it('leaves an unrecognized failure for the LLM', async () => {
    const mystery = [
      '##[group]Run ./deploy.sh',
      './deploy.sh',
      '##[endgroup]',
      'Something unusual happened that no rule describes',
      '##[error]Process completed with exit code 3.',
    ].join('\n');
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: mystery } });

    const result = await processAnalyzeRun({ db, github, log }, job);

    expect(result.analyses).toEqual(['none']);
    expect(await db.select().from(analyses)).toHaveLength(0);
    const [failure] = await db.select().from(failures);
    expect(failure?.category).toBe('unknown');
    expect(failure?.fingerprint).toMatch(/^v1:/);
  });
});

describe('llm fallback', () => {
  const mysteryLog = [
    '##[group]Run ./deploy.sh',
    './deploy.sh',
    '##[endgroup]',
    'Something unusual happened that no rule describes',
    '##[error]Process completed with exit code 3.',
  ].join('\n');

  const llmResult = {
    category: 'configuration' as const,
    title: 'The deploy script failed',
    rootCause: 'deploy.sh exited with status 3 after an unexpected condition.',
    evidence: ['Something unusual happened that no rule describes'],
    likelyFiles: [{ path: 'deploy.sh', reason: 'the failing script' }],
    suggestedFix: 'Run ./deploy.sh locally with bash -x to see which command fails.',
    isLikelyFlaky: false,
    confidence: 0.72,
  };

  function stubLlm(overrides: Partial<LlmAnalysis> = {}) {
    const calls: AnalysisInput[] = [];
    const provider: LlmProvider = {
      name: 'anthropic',
      model: 'claude-opus-5',
      analyze: (llmInput) => {
        calls.push(llmInput);
        return Promise.resolve({
          result: llmResult,
          usage: { inputTokens: 3_000, outputTokens: 250, costUsd: 0.02125 },
          latencyMs: 1_800,
          model: 'claude-opus-5',
          promptVersion: 'v1',
          attempts: 1,
          fellBack: false,
          ...overrides,
        });
      },
    };
    return { provider, calls };
  }

  it('asks the LLM only when no rule matched, and stores usage and cost', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: mysteryLog } });
    const { provider, calls } = stubLlm();

    const result = await processAnalyzeRun({ db, github, log, llm: provider }, job);

    expect(result.analyses).toEqual(['llm']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ repoFullName: 'acme/api', jobName: 'job-102' });
    expect(calls[0]?.excerpt).toContain('Something unusual happened');

    const [analysis] = await db.select().from(analyses);
    expect(analysis).toMatchObject({
      source: 'llm',
      provider: 'anthropic',
      model: 'claude-opus-5',
      promptVersion: 'v1',
      inputTokens: 3_000,
      outputTokens: 250,
      latencyMs: 1_800,
    });
    expect(Number(analysis?.costUsd)).toBeCloseTo(0.02125, 6);
    expect(analysis?.result).toMatchObject({ category: 'configuration' });
  });

  it('does not call the LLM when a rule already explains the failure', async () => {
    const eresolve = [
      '##[group]Run npm ci',
      'npm ERR! ERESOLVE unable to resolve dependency tree',
    ].join('\n');
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: eresolve } });
    const { provider, calls } = stubLlm();

    const result = await processAnalyzeRun({ db, github, log, llm: provider }, job);

    expect(result.analyses).toEqual(['rule']);
    expect(calls).toHaveLength(0);
  });

  it('does not call the LLM when the repository disabled it', async () => {
    await db.update(repositories).set({
      settings: { enabled: true, commentMode: 'single', llmEnabled: false },
    });
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: mysteryLog } });
    const { provider, calls } = stubLlm();

    const result = await processAnalyzeRun({ db, github, log, llm: provider }, job);

    expect(result.analyses).toEqual(['none']);
    expect(calls).toHaveLength(0);
    expect(await db.select().from(analyses)).toHaveLength(0);
  });

  it('reuses an LLM analysis from the cache on the next identical failure', async () => {
    const github = githubStub({ jobs: [workflowJob({ id: 102 })], logs: { 102: mysteryLog } });
    const { provider, calls } = stubLlm();

    await processAnalyzeRun({ db, github, log, llm: provider }, job);
    const second = await processAnalyzeRun(
      {
        db,
        github: githubStub({ jobs: [workflowJob({ id: 909 })], logs: { 909: mysteryLog } }),
        log,
        llm: provider,
      },
      { ...job, runId: job.runId + 5 },
    );

    expect(second.analyses).toEqual(['cache']);
    expect(calls).toHaveLength(1);
  });
});
