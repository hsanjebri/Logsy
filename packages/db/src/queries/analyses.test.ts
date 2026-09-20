import type { AnalysisResult } from '@logsy/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { analyses, repositories } from '../schema.js';
import { truncateAll } from '../testing.js';
import { upsertInstallation, upsertRepositories } from './installations.js';
import { upsertFailure, upsertWorkflowRun } from './runs.js';
import { countFailuresByFingerprint, findCachedAnalysis, insertAnalysis } from './analyses.js';
import { findPrComment, findRunFailures, upsertPrComment } from './comments.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());

const FINGERPRINT = 'v1:0123456789abcdef0123456789abcdef';

const result: AnalysisResult = {
  category: 'dependency_error',
  title: 'npm could not resolve the dependency tree',
  rootCause: 'Conflicting peer dependencies.',
  evidence: ['npm ERR! ERESOLVE unable to resolve dependency tree'],
  likelyFiles: [{ path: 'package.json', reason: 'declares the conflicting versions' }],
  suggestedFix: 'Align the versions.',
  isLikelyFlaky: false,
  confidence: 0.9,
};

let repositoryId = 0;

beforeEach(async () => {
  await truncateAll(db);
  const installationId = await upsertInstallation(db, {
    githubInstallationId: 51_234_567,
    accountLogin: 'acme',
    accountType: 'Organization',
  });
  await upsertRepositories(db, installationId, [
    { githubRepoId: 900_000_001, fullName: 'acme/api', private: false },
  ]);
  const [repo] = await db.select().from(repositories);
  repositoryId = repo?.id ?? 0;
});

async function createFailure(fingerprintValue = FINGERPRINT, runId = 42): Promise<number> {
  const workflowRunId = await upsertWorkflowRun(db, {
    repositoryId,
    githubRunId: runId,
    runAttempt: 1,
    workflowName: 'CI',
    headSha: 'abc',
    headBranch: 'main',
    event: 'push',
    conclusion: 'failure',
    prNumber: null,
    htmlUrl: `https://github.com/acme/api/actions/runs/${runId}`,
  });
  return upsertFailure(db, {
    workflowRunId,
    githubJobId: runId * 10,
    jobName: 'test',
    stepName: 'npm test',
    category: 'dependency_error',
    fingerprint: fingerprintValue,
    errorExcerpt: 'npm ERR! ERESOLVE',
    logCharsOriginal: 1000,
    logCharsTrimmed: 100,
  });
}

describe('insertAnalysis', () => {
  it('stores the result, usage and cost', async () => {
    const failureId = await createFailure();

    await insertAnalysis(db, {
      failureId,
      fingerprint: FINGERPRINT,
      source: 'llm',
      result,
      confidence: 0.9,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptVersion: 'v1',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.0123,
      latencyMs: 2400,
    });

    const [row] = await db.select().from(analyses);
    expect(row).toMatchObject({
      source: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 1200,
      outputTokens: 300,
      latencyMs: 2400,
    });
    expect(Number(row?.costUsd)).toBeCloseTo(0.0123, 6);
    expect(row?.result).toEqual(result);
  });

  it('accepts a rule analysis without provider or usage', async () => {
    const failureId = await createFailure();
    await insertAnalysis(db, {
      failureId,
      fingerprint: FINGERPRINT,
      source: 'rule',
      ruleId: 'npm-eresolve',
      result,
      confidence: 0.9,
    });

    const [row] = await db.select().from(analyses);
    expect(row).toMatchObject({ source: 'rule', ruleId: 'npm-eresolve', model: null });
    expect(row?.costUsd).toBeNull();
  });
});

describe('findCachedAnalysis', () => {
  it('finds the newest analysis for a fingerprint', async () => {
    const first = await createFailure(FINGERPRINT, 42);
    await insertAnalysis(db, {
      failureId: first,
      fingerprint: FINGERPRINT,
      source: 'llm',
      result: { ...result, title: 'older' },
      confidence: 0.8,
    });
    const second = await createFailure(FINGERPRINT, 43);
    await insertAnalysis(db, {
      failureId: second,
      fingerprint: FINGERPRINT,
      source: 'llm',
      result: { ...result, title: 'newer' },
      confidence: 0.9,
    });

    const cached = await findCachedAnalysis(db, FINGERPRINT);

    expect(cached?.result.title).toBe('newer');
    expect(cached?.confidence).toBeCloseTo(0.9, 5);
  });

  it('returns nothing for an unknown fingerprint', async () => {
    expect(await findCachedAnalysis(db, 'v1:unknown')).toBeUndefined();
  });

  it('ignores low-confidence analyses', async () => {
    const failureId = await createFailure();
    await insertAnalysis(db, {
      failureId,
      fingerprint: FINGERPRINT,
      source: 'llm',
      result: { ...result, confidence: 0.2 },
      confidence: 0.2,
    });

    expect(await findCachedAnalysis(db, FINGERPRINT, { minConfidence: 0.5 })).toBeUndefined();
  });

  it('never reuses an entry that was itself a cache hit', async () => {
    const failureId = await createFailure();
    await insertAnalysis(db, {
      failureId,
      fingerprint: FINGERPRINT,
      source: 'cache',
      result,
      confidence: 0.9,
    });

    expect(await findCachedAnalysis(db, FINGERPRINT)).toBeUndefined();
  });

  it('ignores analyses older than the window', async () => {
    const failureId = await createFailure();
    const id = await insertAnalysis(db, {
      failureId,
      fingerprint: FINGERPRINT,
      source: 'llm',
      result,
      confidence: 0.9,
    });
    await db
      .update(analyses)
      .set({ createdAt: sql`now() - interval '200 days'` })
      .where(eq(analyses.id, id));

    expect(await findCachedAnalysis(db, FINGERPRINT, { maxAgeDays: 90 })).toBeUndefined();
    expect(await findCachedAnalysis(db, FINGERPRINT, { maxAgeDays: 365 })).toBeDefined();
  });
});

describe('countFailuresByFingerprint', () => {
  it('counts how often the same failure occurred in a repository', async () => {
    await createFailure(FINGERPRINT, 42);
    await createFailure(FINGERPRINT, 43);
    await createFailure('v1:other', 44);

    expect(await countFailuresByFingerprint(db, repositoryId, FINGERPRINT)).toBe(2);
    expect(await countFailuresByFingerprint(db, repositoryId, 'v1:other')).toBe(1);
    expect(await countFailuresByFingerprint(db, repositoryId, 'v1:none')).toBe(0);
  });
});

describe('findRunFailures', () => {
  it('returns each failure with only its newest analysis', async () => {
    const workflowRunId = await upsertWorkflowRun(db, {
      repositoryId,
      githubRunId: 77,
      runAttempt: 1,
      workflowName: 'CI',
      headSha: 'abc',
      headBranch: 'main',
      event: 'push',
      conclusion: 'failure',
      prNumber: 3,
      htmlUrl: 'https://github.com/acme/api/actions/runs/77',
    });

    const buildFailure = await upsertFailure(db, {
      workflowRunId,
      githubJobId: 1,
      jobName: 'build',
      stepName: 'npm ci',
      category: 'dependency_error',
      fingerprint: FINGERPRINT,
      errorExcerpt: 'npm ERR!',
      logCharsOriginal: 10,
      logCharsTrimmed: 5,
    });
    const lintFailure = await upsertFailure(db, {
      workflowRunId,
      githubJobId: 2,
      jobName: 'lint',
      stepName: 'eslint .',
      category: 'lint_error',
      fingerprint: 'v1:other',
      errorExcerpt: '✖ 3 problems',
      logCharsOriginal: 10,
      logCharsTrimmed: 5,
    });

    await insertAnalysis(db, {
      failureId: buildFailure,
      fingerprint: FINGERPRINT,
      source: 'rule',
      result: { ...result, title: 'older' },
      confidence: 0.6,
    });
    await insertAnalysis(db, {
      failureId: buildFailure,
      fingerprint: FINGERPRINT,
      source: 'llm',
      model: 'claude-opus-5',
      result: { ...result, title: 'newer' },
      confidence: 0.85,
    });

    const failures = await findRunFailures(db, workflowRunId);

    expect(failures).toHaveLength(2);
    const build = failures.find((failure) => failure.failureId === buildFailure);
    expect(build?.result?.title).toBe('newer');
    expect(build?.source).toBe('llm');
    expect(build?.model).toBe('claude-opus-5');

    // A failure with no analysis is still returned, so the comment can show the excerpt.
    const lint = failures.find((failure) => failure.failureId === lintFailure);
    expect(lint?.result).toBeNull();
    expect(lint?.errorExcerpt).toBe('✖ 3 problems');
  });
});

describe('pr comments', () => {
  it('keeps one row per pull request and updates it in place', async () => {
    await upsertPrComment(db, {
      repositoryId,
      prNumber: 7,
      githubCommentId: 100,
      lastRunId: null,
    });
    await upsertPrComment(db, {
      repositoryId,
      prNumber: 7,
      githubCommentId: 100,
      lastRunId: null,
    });

    const found = await findPrComment(db, repositoryId, 7);
    expect(found).toMatchObject({ prNumber: 7, githubCommentId: 100 });
    expect(await findPrComment(db, repositoryId, 8)).toBeUndefined();
  });
});
