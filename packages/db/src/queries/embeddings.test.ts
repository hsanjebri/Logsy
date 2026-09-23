import type { AnalysisResult } from '@logsy/core';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { EMBEDDING_DIMENSIONS, repositories } from '../schema.js';
import { truncateAll } from '../testing.js';
import { insertAnalysis } from './analyses.js';
import { findSimilarFailures, upsertFailureEmbedding } from './embeddings.js';
import { upsertInstallation, upsertRepositories } from './installations.js';
import { upsertFailure, upsertWorkflowRun } from './runs.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());

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

/**
 * A unit vector pointing mostly along one axis. Two directions that are close give a
 * high cosine similarity, which is what the query orders by.
 */
function direction(axis: number, tilt = 0): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[axis] = 1;
  vector[(axis + 1) % EMBEDDING_DIMENSIONS] = tilt;
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

async function storeFailure(options: {
  fingerprint: string;
  runId: number;
  embedding: number[];
  title?: string;
  prNumber?: number | null;
}): Promise<number> {
  const workflowRunId = await upsertWorkflowRun(db, {
    repositoryId,
    githubRunId: options.runId,
    runAttempt: 1,
    workflowName: 'CI',
    headSha: `sha-${String(options.runId)}`,
    headBranch: 'main',
    event: 'pull_request',
    conclusion: 'failure',
    prNumber: options.prNumber ?? null,
    htmlUrl: `https://github.com/acme/api/actions/runs/${String(options.runId)}`,
  });
  const failureId = await upsertFailure(db, {
    workflowRunId,
    githubJobId: options.runId * 10,
    jobName: 'test',
    stepName: 'npm test',
    category: 'dependency_error',
    fingerprint: options.fingerprint,
    errorExcerpt: 'npm ERR! ERESOLVE',
    logCharsOriginal: 1_000,
    logCharsTrimmed: 100,
  });

  if (options.title !== undefined) {
    const result: AnalysisResult = {
      category: 'dependency_error',
      title: options.title,
      rootCause: 'Conflicting peer dependencies.',
      evidence: [],
      likelyFiles: [],
      suggestedFix: 'Align the versions.',
      isLikelyFlaky: false,
      confidence: 0.9,
    };
    await insertAnalysis(db, {
      failureId,
      fingerprint: options.fingerprint,
      source: 'rule',
      result,
      confidence: 0.9,
    });
  }

  await upsertFailureEmbedding(db, {
    failureId,
    repositoryId,
    fingerprint: options.fingerprint,
    embedding: options.embedding,
    model: 'test-embed',
  });
  return failureId;
}

describe('findSimilarFailures', () => {
  it('finds the failure that means the same thing, with its analysis and run', async () => {
    await storeFailure({
      fingerprint: 'v1:old',
      runId: 41,
      embedding: direction(0),
      title: 'npm could not resolve the dependency tree',
      prNumber: 12,
    });
    await storeFailure({ fingerprint: 'v1:other', runId: 40, embedding: direction(300) });

    const matches = await findSimilarFailures(db, {
      repositoryId,
      fingerprint: 'v1:new',
      embedding: direction(0, 0.1),
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      fingerprint: 'v1:old',
      title: 'npm could not resolve the dependency tree',
      prNumber: 12,
      runUrl: 'https://github.com/acme/api/actions/runs/41',
    });
    expect(matches[0]?.similarity).toBeGreaterThan(0.99);
  });

  it('never returns the same fingerprint: that is a recurrence, not a resemblance', async () => {
    await storeFailure({ fingerprint: 'v1:same', runId: 41, embedding: direction(0) });

    await expect(
      findSimilarFailures(db, { repositoryId, fingerprint: 'v1:same', embedding: direction(0) }),
    ).resolves.toEqual([]);
  });

  it('ignores failures that are merely in the same neighbourhood', async () => {
    await storeFailure({ fingerprint: 'v1:old', runId: 41, embedding: direction(5) });

    await expect(
      findSimilarFailures(db, {
        repositoryId,
        fingerprint: 'v1:new',
        embedding: direction(9),
        minSimilarity: 0.85,
      }),
    ).resolves.toEqual([]);
  });

  it('keeps repositories apart', async () => {
    await storeFailure({ fingerprint: 'v1:old', runId: 41, embedding: direction(0) });

    await expect(
      findSimilarFailures(db, {
        repositoryId: repositoryId + 1,
        fingerprint: 'v1:new',
        embedding: direction(0),
      }),
    ).resolves.toEqual([]);
  });

  it('returns the closest first, and no more than asked', async () => {
    await storeFailure({ fingerprint: 'v1:a', runId: 41, embedding: direction(0, 0.4) });
    await storeFailure({ fingerprint: 'v1:b', runId: 42, embedding: direction(0, 0.05) });
    await storeFailure({ fingerprint: 'v1:c', runId: 43, embedding: direction(0, 0.2) });

    const matches = await findSimilarFailures(db, {
      repositoryId,
      fingerprint: 'v1:new',
      embedding: direction(0),
      limit: 2,
    });

    expect(matches.map((match) => match.fingerprint)).toEqual(['v1:b', 'v1:c']);
  });

  it('replaces the embedding when a failure is analysed again', async () => {
    const failureId = await storeFailure({
      fingerprint: 'v1:old',
      runId: 41,
      embedding: direction(0),
    });
    await upsertFailureEmbedding(db, {
      failureId,
      repositoryId,
      fingerprint: 'v1:old',
      embedding: direction(300),
      model: 'test-embed',
    });

    const matches = await findSimilarFailures(db, {
      repositoryId,
      fingerprint: 'v1:new',
      embedding: direction(300),
    });
    expect(matches).toHaveLength(1);
  });
});
