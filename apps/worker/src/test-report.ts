import { detectFlakyTests, parseJUnitFiles } from '@logsy/core';
import {
  deleteResultsForRuns,
  findRepositoryByGithubId,
  countFlakyCommits,
  findResultsForSha,
  findWorkflowRun,
  insertTestResults,
  recordFlakyTest,
  type Database,
  type TestResultInput,
} from '@logsy/db';
import {
  LogsUnavailableError,
  extractXmlFiles,
  looksLikeTestReport,
  type GitHubApp,
} from '@logsy/github';
import type { TestReportJob } from '@logsy/queue';
import type { Logger } from 'pino';

export interface TestReportDeps {
  db: Database;
  github: GitHubApp;
  log: Logger;
}

export interface TestReportResult {
  status: 'stored' | 'skipped';
  reason?: 'unknown-repository' | 'no-artifacts' | 'no-results' | 'run-not-stored';
  testResults: number;
  flaky: number;
}

/**
 * Collects a run's JUnit reports and flags flaky tests. A test is flaky when the very
 * same commit both passed and failed it, so the change under test cannot be the cause.
 */
export async function processTestReport(
  deps: TestReportDeps,
  job: TestReportJob,
): Promise<TestReportResult> {
  const { db, github } = deps;
  const log = deps.log.child({ runId: job.runId, repo: job.repo });

  const repository = await findRepositoryByGithubId(db, job.githubRepoId);
  if (!repository) {
    log.warn('repository is not installed; dropping test report job');
    return { status: 'skipped', reason: 'unknown-repository', testResults: 0, flaky: 0 };
  }

  const run = await findWorkflowRun(db, job.runId, job.runAttempt);
  if (!run) {
    // Successful runs are not stored by the analyzer, so there is nothing to attach to.
    log.debug('run not stored; skipping test report');
    return { status: 'skipped', reason: 'run-not-stored', testResults: 0, flaky: 0 };
  }

  const client = await github.forInstallation(job.installationId);
  const artifacts = (
    await client.listRunArtifacts({
      owner: job.owner,
      repo: job.repo,
      runId: job.runId,
    })
  ).filter(looksLikeTestReport);

  if (artifacts.length === 0) {
    log.debug('run produced no test report artifacts');
    return { status: 'skipped', reason: 'no-artifacts', testResults: 0, flaky: 0 };
  }

  const files: { name: string; content: string }[] = [];
  for (const artifact of artifacts) {
    try {
      const zip = await client.downloadArtifact({
        owner: job.owner,
        repo: job.repo,
        artifactId: artifact.id,
      });
      files.push(...extractXmlFiles(zip));
    } catch (error) {
      if (!(error instanceof LogsUnavailableError)) throw error;
      log.warn({ artifact: artifact.name, status: error.status }, 'artifact unavailable');
    }
  }

  const parsed = parseJUnitFiles(files);
  if (parsed.length === 0) {
    log.info({ artifacts: artifacts.length, files: files.length }, 'no test results found');
    return { status: 'skipped', reason: 'no-results', testResults: 0, flaky: 0 };
  }

  const rows: TestResultInput[] = parsed.map((result) => ({
    repositoryId: repository.id,
    workflowRunId: run.id,
    headSha: job.headSha,
    suite: result.suite,
    testName: result.testName,
    status: result.status,
    durationMs: result.durationMs,
  }));

  // Re-processing the same attempt replaces its rows rather than doubling them.
  await deleteResultsForRuns(db, [run.id]);
  await insertTestResults(db, rows);

  // Flakiness is judged across every attempt of this commit, not this run alone.
  const forSha = await findResultsForSha(db, repository.id, job.headSha);
  const flaky = detectFlakyTests(forSha);
  for (const test of flaky) {
    // The flip count is derived from every commit on record, not incremented, so a
    // re-processed attempt cannot inflate it.
    const flips = await countFlakyCommits(db, repository.id, test);
    await recordFlakyTest(db, repository.id, test, flips);
  }

  log.info(
    {
      testResults: rows.length,
      failed: rows.filter((row) => row.status === 'failed').length,
      flaky: flaky.length,
    },
    'stored test results',
  );
  return { status: 'stored', testResults: rows.length, flaky: flaky.length };
}
