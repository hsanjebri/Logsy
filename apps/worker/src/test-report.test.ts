import {
  createDatabase,
  findFlakyTest,
  repositories,
  flakyTests,
  testResults,
  upsertInstallation,
  upsertRepositories,
  upsertWorkflowRun,
} from '@logsy/db';
import { truncateAll } from '@logsy/db/testing';
import type { TestReportJob } from '@logsy/queue';
import { zipSync, strToU8 } from 'fflate';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { processTestReport } from './test-report.js';
import { githubStub } from './test/github-stub.js';

const { db, pool } = createDatabase(inject('databaseUrl'));
const log = pino({ level: 'silent' });

afterAll(() => pool.end());

const GITHUB_REPO_ID = 900_000_001;
const RUN_ID = 42_000_000_000;
const HEAD_SHA = '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456';

const job: TestReportJob = {
  installationId: 51_234_567,
  githubRepoId: GITHUB_REPO_ID,
  owner: 'acme',
  repo: 'api',
  runId: RUN_ID,
  runAttempt: 1,
  headSha: HEAD_SHA,
};

function report(cases: { name: string; failed?: boolean }[]): string {
  const body = cases
    .map((test) =>
      test.failed
        ? `<testcase classname="suite.Api" name="${test.name}" time="0.5"><failure message="boom">boom</failure></testcase>`
        : `<testcase classname="suite.Api" name="${test.name}" time="0.5"/>`,
    )
    .join('\n');
  return `<testsuites><testsuite name="suite.Api">${body}</testsuite></testsuites>`;
}

function zipOf(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
  );
}

let repositoryId = 0;

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
  const [repo] = await db.select().from(repositories);
  repositoryId = repo?.id ?? 0;
});

async function storeRun(runId: number, runAttempt: number): Promise<number> {
  return upsertWorkflowRun(db, {
    repositoryId,
    githubRunId: runId,
    runAttempt,
    workflowName: 'CI',
    headSha: HEAD_SHA,
    headBranch: 'main',
    event: 'push',
    conclusion: 'failure',
    prNumber: 7,
    htmlUrl: `https://github.com/acme/api/actions/runs/${String(runId)}`,
  });
}

describe('processTestReport', () => {
  it('stores every test result from the run’s report artifacts', async () => {
    await storeRun(RUN_ID, 1);
    const github = githubStub({
      artifacts: [{ id: 5, name: 'test-results' }],
      artifactZips: {
        5: zipOf({ 'junit.xml': report([{ name: 'a' }, { name: 'b', failed: true }]) }),
      },
    });

    const result = await processTestReport({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'stored', testResults: 2, flaky: 0 });
    const stored = await db.select().from(testResults);
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.status).sort()).toEqual(['failed', 'passed']);
    expect(stored[0]).toMatchObject({ suite: 'suite.Api', headSha: HEAD_SHA, durationMs: 500 });
  });

  it('flags a test that failed then passed on a re-run of the same commit', async () => {
    // Attempt 1: the test fails.
    await storeRun(RUN_ID, 1);
    await processTestReport(
      {
        db,
        github: githubStub({
          artifacts: [{ id: 5, name: 'junit' }],
          artifactZips: { 5: zipOf({ 'r.xml': report([{ name: 'retries', failed: true }]) }) },
        }),
        log,
      },
      job,
    );
    expect(
      await findFlakyTest(db, repositoryId, { suite: 'suite.Api', testName: 'retries' }),
    ).toBeUndefined();

    // Attempt 2, same commit: it passes.
    await storeRun(RUN_ID, 2);
    const result = await processTestReport(
      {
        db,
        github: githubStub({
          artifacts: [{ id: 6, name: 'junit' }],
          artifactZips: { 6: zipOf({ 'r.xml': report([{ name: 'retries' }]) }) },
        }),
        log,
      },
      { ...job, runAttempt: 2 },
    );

    expect(result.flaky).toBe(1);
    const flaky = await findFlakyTest(db, repositoryId, {
      suite: 'suite.Api',
      testName: 'retries',
    });
    expect(flaky).toMatchObject({ flipCount: 1, status: 'active' });
    expect(flaky?.lastFlippedAt).toBeInstanceOf(Date);
  });

  it('does not flag a test that failed on every attempt', async () => {
    await storeRun(RUN_ID, 1);
    await processTestReport(
      {
        db,
        github: githubStub({
          artifacts: [{ id: 5, name: 'junit' }],
          artifactZips: { 5: zipOf({ 'r.xml': report([{ name: 'broken', failed: true }]) }) },
        }),
        log,
      },
      job,
    );
    await storeRun(RUN_ID, 2);
    const result = await processTestReport(
      {
        db,
        github: githubStub({
          artifacts: [{ id: 6, name: 'junit' }],
          artifactZips: { 6: zipOf({ 'r.xml': report([{ name: 'broken', failed: true }]) }) },
        }),
        log,
      },
      { ...job, runAttempt: 2 },
    );

    expect(result.flaky).toBe(0);
    expect(await db.select().from(flakyTests)).toHaveLength(0);
  });

  it('replaces the results when the same attempt is processed twice', async () => {
    await storeRun(RUN_ID, 1);
    const github = githubStub({
      artifacts: [{ id: 5, name: 'junit' }],
      artifactZips: { 5: zipOf({ 'r.xml': report([{ name: 'a' }, { name: 'b' }]) }) },
    });

    await processTestReport({ db, github, log }, job);
    await processTestReport({ db, github, log }, job);

    expect(await db.select().from(testResults)).toHaveLength(2);
  });

  it('ignores artifacts that are not test reports', async () => {
    await storeRun(RUN_ID, 1);
    const github = githubStub({
      artifacts: [{ id: 9, name: 'build-output' }],
      artifactZips: { 9: zipOf({ 'app.xml': report([{ name: 'a' }]) }) },
    });

    const result = await processTestReport({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'skipped', reason: 'no-artifacts' });
    expect(await db.select().from(testResults)).toHaveLength(0);
  });

  it('keeps going when an artifact has expired', async () => {
    await storeRun(RUN_ID, 1);
    const github = githubStub({
      artifacts: [
        { id: 1, name: 'test-results-gone' },
        { id: 2, name: 'test-results' },
      ],
      artifactZips: { 2: zipOf({ 'r.xml': report([{ name: 'a' }]) }) },
    });

    const result = await processTestReport({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'stored', testResults: 1 });
  });

  it('skips a run that was never stored, which is every passing run', async () => {
    const github = githubStub({ artifacts: [{ id: 5, name: 'junit' }] });

    const result = await processTestReport({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'skipped', reason: 'run-not-stored' });
  });

  it('skips when the archive holds no readable results', async () => {
    await storeRun(RUN_ID, 1);
    const github = githubStub({
      artifacts: [{ id: 5, name: 'test-results' }],
      artifactZips: { 5: zipOf({ 'notes.txt': 'nothing here' }) },
    });

    const result = await processTestReport({ db, github, log }, job);

    expect(result).toMatchObject({ status: 'skipped', reason: 'no-results' });
  });
});

describe('flip counting', () => {
  it('counts commits, not runs, and never inflates on re-processing', async () => {
    const flakyReport = (failed: boolean) =>
      zipOf({ 'r.xml': report([{ name: 'retries', failed }]) });
    const runFor = async (runId: number, attempt: number, sha: string, failed: boolean) => {
      await upsertWorkflowRun(db, {
        repositoryId,
        githubRunId: runId,
        runAttempt: attempt,
        workflowName: 'CI',
        headSha: sha,
        headBranch: 'main',
        event: 'push',
        conclusion: 'failure',
        prNumber: null,
        htmlUrl: `https://github.com/acme/api/actions/runs/${String(runId)}`,
      });
      await processTestReport(
        {
          db,
          github: githubStub({
            artifacts: [{ id: runId, name: 'test-results' }],
            artifactZips: { [runId]: flakyReport(failed) },
          }),
          log,
        },
        { ...job, runId, runAttempt: attempt, headSha: sha },
      );
    };

    // Commit one flips.
    await runFor(1, 1, 'sha-one', true);
    await runFor(1, 2, 'sha-one', false);
    const test = { suite: 'suite.Api', testName: 'retries' };
    expect((await findFlakyTest(db, repositoryId, test))?.flipCount).toBe(1);

    // Processing the same attempt again must not count twice.
    await runFor(1, 2, 'sha-one', false);
    expect((await findFlakyTest(db, repositoryId, test))?.flipCount).toBe(1);

    // A second commit flips too.
    await runFor(2, 1, 'sha-two', true);
    await runFor(2, 2, 'sha-two', false);
    expect((await findFlakyTest(db, repositoryId, test))?.flipCount).toBe(2);
  });
});
