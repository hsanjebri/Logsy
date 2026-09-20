import type { AnalysisResult } from '@logsy/core';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { repositories } from '../schema.js';
import { truncateAll } from '../testing.js';
import { insertAnalysis } from './analyses.js';
import { findAnalysisOwner, findFeedback, getFeedbackStats, recordFeedback } from './feedback.js';
import { upsertInstallation, upsertRepositories } from './installations.js';
import { upsertFailure, upsertWorkflowRun } from './runs.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());

const API_REPO = 910_000_001;
const WEB_REPO = 910_000_002;

const result: AnalysisResult = {
  category: 'test_failure',
  title: 'OrderServiceTest.retries failed',
  rootCause: 'The assertion on the retry count did not hold.',
  evidence: [],
  likelyFiles: [],
  suggestedFix: 'Check the retry budget.',
  isLikelyFlaky: false,
  confidence: 0.8,
};

let apiId = 0;
let webId = 0;

beforeEach(async () => {
  await truncateAll(db);
  const installationId = await upsertInstallation(db, {
    githubInstallationId: 52_000_001,
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

async function seedAnalysis(repositoryId: number, githubRunId: number): Promise<number> {
  const workflowRunId = await upsertWorkflowRun(db, {
    repositoryId,
    githubRunId,
    runAttempt: 1,
    workflowName: 'CI',
    headSha: `sha-${String(githubRunId)}`,
    headBranch: 'main',
    event: 'pull_request',
    conclusion: 'failure',
    prNumber: 7,
    htmlUrl: `https://github.com/acme/api/actions/runs/${String(githubRunId)}`,
  });
  const failureId = await upsertFailure(db, {
    workflowRunId,
    githubJobId: githubRunId * 10,
    jobName: 'test',
    stepName: 'npm test',
    category: 'test_failure',
    fingerprint: 'v1:bbb',
    errorExcerpt: 'AssertionError',
    logCharsOriginal: 100,
    logCharsTrimmed: 50,
  });
  return insertAnalysis(db, {
    failureId,
    fingerprint: 'v1:bbb',
    source: 'llm',
    result,
    confidence: 0.8,
  });
}

describe('recordFeedback', () => {
  it('stores a verdict and reads it back for that person', async () => {
    const analysisId = await seedAnalysis(apiId, 1);

    await recordFeedback(db, { analysisId, githubUser: 'octocat', verdict: 'helpful' });

    expect(await findFeedback(db, analysisId, 'octocat')).toMatchObject({
      verdict: 'helpful',
      note: null,
    });
  });

  it('replaces an earlier vote instead of counting it twice', async () => {
    const analysisId = await seedAnalysis(apiId, 1);

    await recordFeedback(db, { analysisId, githubUser: 'octocat', verdict: 'helpful' });
    await recordFeedback(db, {
      analysisId,
      githubUser: 'octocat',
      verdict: 'wrong',
      note: 'wrong file',
    });

    expect(await findFeedback(db, analysisId, 'octocat')).toMatchObject({
      verdict: 'wrong',
      note: 'wrong file',
    });
    expect(await getFeedbackStats(db, apiId)).toEqual({ helpful: 0, wrong: 1 });
  });

  it('keeps one person’s vote separate from another’s', async () => {
    const analysisId = await seedAnalysis(apiId, 1);

    await recordFeedback(db, { analysisId, githubUser: 'octocat', verdict: 'helpful' });
    await recordFeedback(db, { analysisId, githubUser: 'hubot', verdict: 'wrong' });

    expect(await getFeedbackStats(db, apiId)).toEqual({ helpful: 1, wrong: 1 });
  });

  it('returns nothing when this person has not voted', async () => {
    const analysisId = await seedAnalysis(apiId, 1);

    expect(await findFeedback(db, analysisId, 'octocat')).toBeUndefined();
  });
});

describe('findAnalysisOwner', () => {
  it('names the repository an analysis belongs to, with its title', async () => {
    const analysisId = await seedAnalysis(apiId, 1);

    expect(await findAnalysisOwner(db, analysisId)).toEqual({
      analysisId,
      repositoryId: apiId,
      title: 'OrderServiceTest.retries failed',
    });
  });

  it('returns nothing for an analysis that does not exist', async () => {
    // The feedback page turns this into a 404 rather than leaking whether the id is real.
    expect(await findAnalysisOwner(db, 999_999)).toBeUndefined();
  });
});

describe('getFeedbackStats', () => {
  it('counts only the votes on this repository’s analyses', async () => {
    const apiAnalysis = await seedAnalysis(apiId, 1);
    const webAnalysis = await seedAnalysis(webId, 2);

    await recordFeedback(db, {
      analysisId: apiAnalysis,
      githubUser: 'octocat',
      verdict: 'helpful',
    });
    await recordFeedback(db, { analysisId: webAnalysis, githubUser: 'octocat', verdict: 'wrong' });

    expect(await getFeedbackStats(db, apiId)).toEqual({ helpful: 1, wrong: 0 });
    expect(await getFeedbackStats(db, webId)).toEqual({ helpful: 0, wrong: 1 });
  });

  it('reports zeros for a repository nobody has judged', async () => {
    expect(await getFeedbackStats(db, apiId)).toEqual({ helpful: 0, wrong: 0 });
  });
});
