import type { FlakyTestRef, TestStatus } from '@logsy/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { failures, flakyTests, testResults, workflowRuns } from '../schema.js';

export interface TestResultInput {
  repositoryId: number;
  workflowRunId: number;
  headSha: string;
  suite: string;
  testName: string;
  status: TestStatus;
  durationMs: number | null;
}

/** Stores a run's test results. Re-running the same report simply adds rows. */
export async function insertTestResults(
  db: Executor,
  rows: readonly TestResultInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  // Postgres caps parameters per statement, so large suites go in batches.
  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    await db.insert(testResults).values(rows.slice(index, index + batchSize));
  }
  return rows.length;
}

/**
 * Every result recorded for one commit, across attempts and jobs. This is the input
 * to the flaky rule: the code is identical, so a differing outcome is the test's own.
 */
export async function findResultsForSha(db: Executor, repositoryId: number, headSha: string) {
  return db
    .select({
      suite: testResults.suite,
      testName: testResults.testName,
      status: testResults.status,
      durationMs: testResults.durationMs,
    })
    .from(testResults)
    .where(and(eq(testResults.repositoryId, repositoryId), eq(testResults.headSha, headSha)));
}

/**
 * How many distinct commits this test has contradicted itself on. Counting commits
 * rather than runs keeps the number meaningful, and makes re-processing an attempt
 * harmless: the answer is derived from the stored results, never incremented.
 */
export async function countFlakyCommits(
  db: Executor,
  repositoryId: number,
  test: FlakyTestRef,
): Promise<number> {
  const rows = await db
    .select({ headSha: testResults.headSha })
    .from(testResults)
    .where(
      and(
        eq(testResults.repositoryId, repositoryId),
        eq(testResults.suite, test.suite),
        eq(testResults.testName, test.testName),
      ),
    )
    .groupBy(testResults.headSha)
    .having(
      sql`bool_or(${testResults.status} = 'passed') and bool_or(${testResults.status} = 'failed')`,
    );
  return rows.length;
}

/** Records the test as flaky with an exact flip count. Safe to call repeatedly. */
export async function recordFlakyTest(
  db: Executor,
  repositoryId: number,
  test: FlakyTestRef,
  flipCount = 1,
): Promise<void> {
  await db
    .insert(flakyTests)
    .values({
      repositoryId,
      suite: test.suite,
      testName: test.testName,
      flipCount,
      lastFlippedAt: sql`now()`,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [flakyTests.repositoryId, flakyTests.suite, flakyTests.testName],
      set: { flipCount, lastFlippedAt: sql`now()`, status: 'active' },
    });
}

export async function findFlakyTest(db: Executor, repositoryId: number, test: FlakyTestRef) {
  const [row] = await db
    .select()
    .from(flakyTests)
    .where(
      and(
        eq(flakyTests.repositoryId, repositoryId),
        eq(flakyTests.suite, test.suite),
        eq(flakyTests.testName, test.testName),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Known flaky tests that failed in this run: what the PR comment should mention, so a
 * developer is not sent hunting for a bug in their change.
 */
export async function findKnownFlakyFailures(
  db: Executor,
  repositoryId: number,
  workflowRunId: number,
) {
  return db
    .select({
      suite: flakyTests.suite,
      testName: flakyTests.testName,
      flipCount: flakyTests.flipCount,
    })
    .from(flakyTests)
    .innerJoin(
      testResults,
      and(
        eq(testResults.repositoryId, flakyTests.repositoryId),
        eq(testResults.suite, flakyTests.suite),
        eq(testResults.testName, flakyTests.testName),
      ),
    )
    .where(
      and(
        eq(flakyTests.repositoryId, repositoryId),
        eq(flakyTests.status, 'active'),
        eq(testResults.workflowRunId, workflowRunId),
        eq(testResults.status, 'failed'),
      ),
    )
    .groupBy(flakyTests.suite, flakyTests.testName, flakyTests.flipCount);
}

/** Run ids of the attempts stored for a commit, used to gather all its results. */
export async function findRunIdsForSha(
  db: Executor,
  repositoryId: number,
  headSha: string,
): Promise<number[]> {
  const rows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.repositoryId, repositoryId), eq(workflowRuns.headSha, headSha)));
  return rows.map((row) => row.id);
}

/** True when any failure of this run is already stored, used to avoid double work. */
export async function hasStoredResults(db: Executor, workflowRunId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: testResults.id })
    .from(testResults)
    .where(eq(testResults.workflowRunId, workflowRunId))
    .limit(1);
  return row !== undefined;
}

export async function deleteResultsForRuns(db: Executor, runIds: readonly number[]): Promise<void> {
  if (runIds.length === 0) return;
  await db.delete(testResults).where(inArray(testResults.workflowRunId, [...runIds]));
}

/** Only used by tests and the dashboard's run view. */
export async function countFailuresForRun(db: Executor, workflowRunId: number): Promise<number> {
  const rows = await db
    .select({ id: failures.id })
    .from(failures)
    .where(eq(failures.workflowRunId, workflowRunId));
  return rows.length;
}
