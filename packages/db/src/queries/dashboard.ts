import type { FailureCategory } from '@logsy/core';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import {
  analyses,
  failures,
  flakyTests,
  repositories,
  workflowRuns,
  type RepositorySettings,
} from '../schema.js';

/** Read models for the dashboard. Every query is scoped to repositories the viewer can see. */

export interface RepositorySummary {
  id: number;
  githubRepoId: number;
  fullName: string;
  private: boolean;
  settings: RepositorySettings;
  failedRuns: number;
  lastFailureAt: Date | null;
}

const since = (days: number) => sql`now() - make_interval(days => ${days})`;

/** The repositories the viewer has access to, with their recent failure counts. */
export async function listRepositories(
  db: Executor,
  githubRepoIds: readonly number[],
  days = 14,
): Promise<RepositorySummary[]> {
  if (githubRepoIds.length === 0) return [];

  const rows = await db
    .select({
      id: repositories.id,
      githubRepoId: repositories.githubRepoId,
      fullName: repositories.fullName,
      private: repositories.private,
      settings: repositories.settings,
      failedRuns: count(workflowRuns.id),
      lastFailureAt: sql<Date | null>`max(${workflowRuns.createdAt})`,
    })
    .from(repositories)
    .leftJoin(
      workflowRuns,
      and(
        eq(workflowRuns.repositoryId, repositories.id),
        eq(workflowRuns.conclusion, 'failure'),
        gte(workflowRuns.createdAt, since(days)),
      ),
    )
    .where(inArray(repositories.githubRepoId, [...githubRepoIds]))
    .groupBy(repositories.id)
    .orderBy(desc(sql`max(${workflowRuns.createdAt})`), repositories.fullName);

  return rows.map((row) => ({
    ...row,
    lastFailureAt: row.lastFailureAt === null ? null : new Date(row.lastFailureAt),
  }));
}

export async function findRepositoryByFullName(db: Executor, fullName: string) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, fullName))
    .limit(1);
  return row;
}

export interface OverviewStats {
  failedRuns: number;
  failures: number;
  explained: number;
  bySource: { rule: number; llm: number; cache: number };
  costUsd: number;
}

export async function getOverviewStats(
  db: Executor,
  repositoryId: number,
  days = 14,
): Promise<OverviewStats> {
  const [runs] = await db
    .select({ total: count() })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.repositoryId, repositoryId),
        eq(workflowRuns.conclusion, 'failure'),
        gte(workflowRuns.createdAt, since(days)),
      ),
    );

  const rows = await db
    .select({
      source: analyses.source,
      total: count(),
      cost: sql<string>`coalesce(sum(${analyses.costUsd}), 0)`,
    })
    .from(analyses)
    .innerJoin(failures, eq(failures.id, analyses.failureId))
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(and(eq(workflowRuns.repositoryId, repositoryId), gte(analyses.createdAt, since(days))))
    .groupBy(analyses.source);

  const [failureCount] = await db
    .select({ total: count() })
    .from(failures)
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(and(eq(workflowRuns.repositoryId, repositoryId), gte(failures.createdAt, since(days))));

  const bySource = { rule: 0, llm: 0, cache: 0 };
  let costUsd = 0;
  for (const row of rows) {
    bySource[row.source] = row.total;
    costUsd += Number(row.cost);
  }

  return {
    failedRuns: runs?.total ?? 0,
    failures: failureCount?.total ?? 0,
    explained: bySource.rule + bySource.llm + bySource.cache,
    bySource,
    costUsd,
  };
}

export interface DailyCount {
  day: string;
  failures: number;
}

/** Failed runs per day, oldest first, with empty days filled in. */
export async function getFailuresPerDay(
  db: Executor,
  repositoryId: number,
  days = 14,
): Promise<DailyCount[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${workflowRuns.createdAt}), 'YYYY-MM-DD')`,
      failures: count(),
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.repositoryId, repositoryId),
        eq(workflowRuns.conclusion, 'failure'),
        gte(workflowRuns.createdAt, since(days)),
      ),
    )
    .groupBy(sql`date_trunc('day', ${workflowRuns.createdAt})`);

  const counts = new Map(rows.map((row) => [row.day, row.failures]));
  const result: DailyCount[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000);
    const day = date.toISOString().slice(0, 10);
    result.push({ day, failures: counts.get(day) ?? 0 });
  }
  return result;
}

export interface CategoryCount {
  category: FailureCategory;
  total: number;
}

export async function getCategoryBreakdown(
  db: Executor,
  repositoryId: number,
  days = 14,
): Promise<CategoryCount[]> {
  return db
    .select({ category: failures.category, total: count() })
    .from(failures)
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .where(and(eq(workflowRuns.repositoryId, repositoryId), gte(failures.createdAt, since(days))))
    .groupBy(failures.category)
    .orderBy(desc(count()));
}

export interface RecurringFailure {
  fingerprint: string;
  title: string;
  category: FailureCategory;
  occurrences: number;
  lastSeenAt: Date;
}

/** Fingerprints seen more than once, most frequent first. */
export async function getRecurringFailures(
  db: Executor,
  repositoryId: number,
  limit = 10,
): Promise<RecurringFailure[]> {
  const rows = await db
    .select({
      fingerprint: failures.fingerprint,
      category: failures.category,
      jobName: failures.jobName,
      occurrences: count(),
      lastSeenAt: sql<string>`max(${failures.createdAt})`,
      title: sql<string | null>`max(${analyses.result} ->> 'title')`,
    })
    .from(failures)
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .leftJoin(analyses, eq(analyses.failureId, failures.id))
    .where(eq(workflowRuns.repositoryId, repositoryId))
    .groupBy(failures.fingerprint, failures.category, failures.jobName)
    .orderBy(desc(count()), desc(sql`max(${failures.createdAt})`))
    .limit(limit);

  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    category: row.category,
    title: row.title ?? `Unexplained failure in ${row.jobName}`,
    occurrences: row.occurrences,
    lastSeenAt: new Date(row.lastSeenAt),
  }));
}

export interface RunSummary {
  id: number;
  githubRunId: number;
  runAttempt: number;
  workflowName: string;
  headBranch: string | null;
  headSha: string;
  prNumber: number | null;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: Date;
  failureCount: number;
}

export async function listRuns(
  db: Executor,
  repositoryId: number,
  limit = 20,
): Promise<RunSummary[]> {
  return db
    .select({
      id: workflowRuns.id,
      githubRunId: workflowRuns.githubRunId,
      runAttempt: workflowRuns.runAttempt,
      workflowName: workflowRuns.workflowName,
      headBranch: workflowRuns.headBranch,
      headSha: workflowRuns.headSha,
      prNumber: workflowRuns.prNumber,
      conclusion: workflowRuns.conclusion,
      htmlUrl: workflowRuns.htmlUrl,
      createdAt: workflowRuns.createdAt,
      failureCount: count(failures.id),
    })
    .from(workflowRuns)
    .leftJoin(failures, eq(failures.workflowRunId, workflowRuns.id))
    .where(eq(workflowRuns.repositoryId, repositoryId))
    .groupBy(workflowRuns.id)
    .orderBy(desc(workflowRuns.createdAt))
    .limit(limit);
}

export async function findRunByGithubId(db: Executor, repositoryId: number, githubRunId: number) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.repositoryId, repositoryId), eq(workflowRuns.githubRunId, githubRunId)),
    )
    .orderBy(desc(workflowRuns.runAttempt))
    .limit(1);
  return row;
}

export async function listFlakyTests(db: Executor, repositoryId: number, limit = 25) {
  return db
    .select()
    .from(flakyTests)
    .where(eq(flakyTests.repositoryId, repositoryId))
    .orderBy(desc(flakyTests.flipCount))
    .limit(limit);
}

export async function updateRepositorySettings(
  db: Executor,
  repositoryId: number,
  settings: RepositorySettings,
): Promise<void> {
  await db.update(repositories).set({ settings }).where(eq(repositories.id, repositoryId));
}
