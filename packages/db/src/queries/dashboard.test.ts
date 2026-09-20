import type { AnalysisResult } from '@logsy/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { repositories, workflowRuns } from '../schema.js';
import { truncateAll } from '../testing.js';
import { insertAnalysis } from './analyses.js';
import {
  findRepositoryByFullName,
  findRunByGithubId,
  getCategoryBreakdown,
  getFailuresPerDay,
  getOverviewStats,
  getRecurringFailures,
  listRepositories,
  listRuns,
  updateRepositorySettings,
} from './dashboard.js';
import { upsertInstallation, upsertRepositories } from './installations.js';
import { upsertFailure, upsertWorkflowRun } from './runs.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());

const API_REPO = 900_000_001;
const WEB_REPO = 900_000_002;

const result: AnalysisResult = {
  category: 'dependency_error',
  title: 'npm could not resolve the dependency tree',
  rootCause: 'Peer conflict.',
  evidence: [],
  likelyFiles: [],
  suggestedFix: 'Align versions.',
  isLikelyFlaky: false,
  confidence: 0.9,
};

let apiId = 0;
let webId = 0;

beforeEach(async () => {
  await truncateAll(db);
  const installationId = await upsertInstallation(db, {
    githubInstallationId: 51_234_567,
    accountLogin: 'acme',
    accountType: 'Organization',
  });
  await upsertRepositories(db, installationId, [
    { githubRepoId: API_REPO, fullName: 'acme/api', private: false },
    { githubRepoId: WEB_REPO, fullName: 'acme/web', private: true },
  ]);
  const repos = await db.select().from(repositories);
  apiId = repos.find((repo) => repo.githubRepoId === API_REPO)?.id ?? 0;
  webId = repos.find((repo) => repo.githubRepoId === WEB_REPO)?.id ?? 0;
});

interface SeedOptions {
  repositoryId?: number;
  githubRunId: number;
  conclusion?: string;
  category?: 'dependency_error' | 'test_failure' | 'lint_error';
  fingerprint?: string;
  daysAgo?: number;
  withAnalysis?: boolean;
  source?: 'rule' | 'llm' | 'cache';
  costUsd?: number;
}

async function seedRun(options: SeedOptions): Promise<void> {
  const repositoryId = options.repositoryId ?? apiId;
  const workflowRunId = await upsertWorkflowRun(db, {
    repositoryId,
    githubRunId: options.githubRunId,
    runAttempt: 1,
    workflowName: 'CI',
    headSha: `sha-${String(options.githubRunId)}`,
    headBranch: 'main',
    event: 'push',
    conclusion: options.conclusion ?? 'failure',
    prNumber: 7,
    htmlUrl: `https://github.com/acme/api/actions/runs/${String(options.githubRunId)}`,
  });

  if (options.daysAgo !== undefined) {
    await db
      .update(workflowRuns)
      .set({ createdAt: sql`now() - make_interval(days => ${options.daysAgo})` })
      .where(sql`${workflowRuns.id} = ${workflowRunId}`);
  }

  if (options.conclusion === 'success') return;

  const failureId = await upsertFailure(db, {
    workflowRunId,
    githubJobId: options.githubRunId * 10,
    jobName: 'build',
    stepName: 'npm ci',
    category: options.category ?? 'dependency_error',
    fingerprint: options.fingerprint ?? 'v1:aaa',
    errorExcerpt: 'npm ERR!',
    logCharsOriginal: 100,
    logCharsTrimmed: 50,
  });

  if (options.withAnalysis !== false) {
    await insertAnalysis(db, {
      failureId,
      fingerprint: options.fingerprint ?? 'v1:aaa',
      source: options.source ?? 'rule',
      result,
      confidence: 0.9,
      ...(options.costUsd === undefined ? {} : { costUsd: options.costUsd }),
    });
  }
}

describe('listRepositories', () => {
  it('returns only the repositories the viewer can see', async () => {
    await seedRun({ githubRunId: 1 });

    const visible = await listRepositories(db, [API_REPO]);

    expect(visible.map((repo) => repo.fullName)).toEqual(['acme/api']);
    expect(visible[0]?.failedRuns).toBe(1);
    expect(visible[0]?.lastFailureAt).toBeInstanceOf(Date);
  });

  it('returns nothing when the viewer has access to no repository', async () => {
    expect(await listRepositories(db, [])).toEqual([]);
    expect(await listRepositories(db, [123_456])).toEqual([]);
  });

  it('lists a repository with no failures, with a zero count', async () => {
    const visible = await listRepositories(db, [API_REPO, WEB_REPO]);
    expect(visible).toHaveLength(2);
    expect(visible.every((repo) => repo.failedRuns === 0)).toBe(true);
  });

  it('counts only failures inside the window', async () => {
    await seedRun({ githubRunId: 1, daysAgo: 2 });
    await seedRun({ githubRunId: 2, daysAgo: 40 });

    const [repo] = await listRepositories(db, [API_REPO], 14);
    expect(repo?.failedRuns).toBe(1);
  });
});

describe('getOverviewStats', () => {
  it('counts runs, failures and how each was explained', async () => {
    await seedRun({ githubRunId: 1, source: 'rule' });
    await seedRun({ githubRunId: 2, source: 'llm', costUsd: 0.0123 });
    await seedRun({ githubRunId: 3, source: 'cache' });
    await seedRun({ githubRunId: 4, withAnalysis: false });
    // Another repository must not leak into these numbers.
    await seedRun({ githubRunId: 5, repositoryId: webId });

    const stats = await getOverviewStats(db, apiId);

    expect(stats.failedRuns).toBe(4);
    expect(stats.failures).toBe(4);
    expect(stats.explained).toBe(3);
    expect(stats.bySource).toEqual({ rule: 1, llm: 1, cache: 1 });
    expect(stats.costUsd).toBeCloseTo(0.0123, 6);
  });

  it('is all zeros for a repository with no data', async () => {
    const stats = await getOverviewStats(db, webId);
    expect(stats).toMatchObject({ failedRuns: 0, failures: 0, explained: 0, costUsd: 0 });
  });
});

describe('getFailuresPerDay', () => {
  it('returns one entry per day, oldest first, with empty days at zero', async () => {
    await seedRun({ githubRunId: 1, daysAgo: 0 });
    await seedRun({ githubRunId: 2, daysAgo: 0 });
    await seedRun({ githubRunId: 3, daysAgo: 3 });

    const days = await getFailuresPerDay(db, apiId, 7);

    expect(days).toHaveLength(7);
    // Oldest first.
    expect([...days].map((day) => day.day).sort()).toEqual(days.map((day) => day.day));
    expect(days.at(-1)?.failures).toBe(2);
    expect(days[3]?.failures).toBe(1);
    expect(days.reduce((total, day) => total + day.failures, 0)).toBe(3);
  });
});

describe('getCategoryBreakdown', () => {
  it('counts failures per category, largest first', async () => {
    await seedRun({ githubRunId: 1, category: 'test_failure' });
    await seedRun({ githubRunId: 2, category: 'test_failure' });
    await seedRun({ githubRunId: 3, category: 'lint_error' });

    const breakdown = await getCategoryBreakdown(db, apiId);

    expect(breakdown).toEqual([
      { category: 'test_failure', total: 2 },
      { category: 'lint_error', total: 1 },
    ]);
  });
});

describe('getRecurringFailures', () => {
  it('groups by fingerprint and uses the analysis title', async () => {
    await seedRun({ githubRunId: 1, fingerprint: 'v1:aaa' });
    await seedRun({ githubRunId: 2, fingerprint: 'v1:aaa' });
    await seedRun({ githubRunId: 3, fingerprint: 'v1:bbb' });

    const recurring = await getRecurringFailures(db, apiId);

    expect(recurring[0]).toMatchObject({
      fingerprint: 'v1:aaa',
      occurrences: 2,
      title: 'npm could not resolve the dependency tree',
    });
    expect(recurring[1]?.occurrences).toBe(1);
  });

  it('falls back to a job-based title when nothing explained the failure', async () => {
    await seedRun({ githubRunId: 1, withAnalysis: false });
    const [recurring] = await getRecurringFailures(db, apiId);
    expect(recurring?.title).toBe('Unexplained failure in build');
  });
});

describe('runs', () => {
  it('lists runs newest first with their failure counts', async () => {
    await seedRun({ githubRunId: 1, daysAgo: 3 });
    await seedRun({ githubRunId: 2, daysAgo: 1 });

    const runs = await listRuns(db, apiId);

    expect(runs.map((run) => run.githubRunId)).toEqual([2, 1]);
    expect(runs[0]?.failureCount).toBe(1);
  });

  it('finds one run by its GitHub id, scoped to the repository', async () => {
    await seedRun({ githubRunId: 1 });

    expect(await findRunByGithubId(db, apiId, 1)).toBeDefined();
    expect(await findRunByGithubId(db, webId, 1)).toBeUndefined();
  });
});

describe('settings', () => {
  it('updates a repository’s settings', async () => {
    await updateRepositorySettings(db, apiId, {
      enabled: false,
      commentMode: 'off',
      llmEnabled: false,
    });

    const repo = await findRepositoryByFullName(db, 'acme/api');
    expect(repo?.settings).toEqual({ enabled: false, commentMode: 'off', llmEnabled: false });
  });
});
