import { FAILURE_CATEGORIES } from '@logsy/core';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// Column names are camelCase here and snake_case in Postgres (`casing: 'snake_case'`).
// GitHub IDs exceed 2^31, so they are bigint; `mode: 'number'` is safe up to 2^53.

const id = () => integer().primaryKey().generatedAlwaysAsIdentity();
const githubId = () => bigint({ mode: 'number' });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const failureCategoryEnum = pgEnum('failure_category', FAILURE_CATEGORIES);
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'received',
  'processed',
  'ignored',
  'failed',
]);
export const analysisSourceEnum = pgEnum('analysis_source', ['rule', 'llm', 'cache']);
export const testStatusEnum = pgEnum('test_status', ['passed', 'failed', 'skipped']);
export const flakyStatusEnum = pgEnum('flaky_status', ['active', 'resolved']);
export const feedbackVerdictEnum = pgEnum('feedback_verdict', ['helpful', 'wrong']);

export interface RepositorySettings {
  enabled: boolean;
  /** `single`: upsert one comment per PR. `off`: analyze and store, never comment. */
  commentMode: 'single' | 'off';
  llmEnabled: boolean;
  /** Also publish a check run, which puts the explanation on the diff itself. */
  checksEnabled?: boolean;
  /**
   * Re-run the failed jobs once when the failure looks flaky. Off by default: it
   * spends the repository's CI minutes.
   */
  autoRerun?: boolean;
}

export const DEFAULT_REPOSITORY_SETTINGS: RepositorySettings = {
  enabled: true,
  commentMode: 'single',
  llmEnabled: true,
  checksEnabled: true,
};

export const installations = pgTable('installations', {
  id: id(),
  githubInstallationId: githubId().notNull().unique(),
  accountLogin: text().notNull(),
  accountType: text().notNull(),
  createdAt: createdAt(),
  suspendedAt: timestamp({ withTimezone: true }),
});

export const repositories = pgTable(
  'repositories',
  {
    id: id(),
    installationId: integer()
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    githubRepoId: githubId().notNull().unique(),
    fullName: text().notNull(),
    private: boolean().notNull(),
    settings: jsonb().$type<RepositorySettings>().notNull().default(DEFAULT_REPOSITORY_SETTINGS),
    createdAt: createdAt(),
  },
  (table) => [index().on(table.installationId), index().on(table.fullName)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    deliveryId: text().primaryKey(),
    event: text().notNull(),
    action: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    status: deliveryStatusEnum().notNull().default('received'),
  },
  (table) => [index().on(table.receivedAt)],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: id(),
    repositoryId: integer()
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    githubRunId: githubId().notNull(),
    runAttempt: integer().notNull(),
    workflowName: text().notNull(),
    headSha: text().notNull(),
    headBranch: text(),
    event: text().notNull(),
    conclusion: text(),
    prNumber: integer(),
    htmlUrl: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique().on(table.githubRunId, table.runAttempt),
    index().on(table.repositoryId, table.createdAt),
    index().on(table.repositoryId, table.headSha),
  ],
);

export const failures = pgTable(
  'failures',
  {
    id: id(),
    workflowRunId: integer()
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    githubJobId: githubId().notNull(),
    jobName: text().notNull(),
    stepName: text(),
    category: failureCategoryEnum().notNull().default('unknown'),
    fingerprint: text().notNull(),
    /** Always redacted before insert. */
    errorExcerpt: text().notNull(),
    logCharsOriginal: integer().notNull(),
    logCharsTrimmed: integer().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // A job appears once per run attempt; re-analysis updates the row in place.
    unique().on(table.workflowRunId, table.githubJobId),
    index().on(table.fingerprint),
  ],
);

export const analyses = pgTable(
  'analyses',
  {
    id: id(),
    failureId: integer()
      .notNull()
      .references(() => failures.id, { onDelete: 'cascade' }),
    fingerprint: text().notNull(),
    source: analysisSourceEnum().notNull(),
    ruleId: text(),
    provider: text(),
    model: text(),
    promptVersion: text(),
    // Typed by the LLM package's output schema once it exists (Phase 5).
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    confidence: real().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    latencyMs: integer(),
    createdAt: createdAt(),
  },
  (table) => [index().on(table.failureId), index().on(table.fingerprint, table.createdAt)],
);

export const prComments = pgTable(
  'pr_comments',
  {
    id: id(),
    repositoryId: integer()
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    prNumber: integer().notNull(),
    githubCommentId: githubId().notNull(),
    lastRunId: integer().references(() => workflowRuns.id, { onDelete: 'set null' }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.repositoryId, table.prNumber)],
);

export const testResults = pgTable(
  'test_results',
  {
    id: id(),
    repositoryId: integer()
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    workflowRunId: integer()
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    headSha: text().notNull(),
    suite: text().notNull(),
    testName: text().notNull(),
    status: testStatusEnum().notNull(),
    durationMs: integer(),
    createdAt: createdAt(),
  },
  (table) => [
    index().on(table.repositoryId, table.suite, table.testName, table.createdAt),
    index().on(table.repositoryId, table.headSha),
    index().on(table.workflowRunId),
  ],
);

export const flakyTests = pgTable(
  'flaky_tests',
  {
    id: id(),
    repositoryId: integer()
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    suite: text().notNull(),
    testName: text().notNull(),
    flipCount: integer().notNull().default(0),
    lastFlippedAt: timestamp({ withTimezone: true }),
    firstDetectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    status: flakyStatusEnum().notNull().default('active'),
  },
  (table) => [unique().on(table.repositoryId, table.suite, table.testName)],
);

export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    analysisId: integer()
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    githubUser: text().notNull(),
    verdict: feedbackVerdictEnum().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  // One vote per user per analysis; a second vote replaces the first.
  (table) => [unique().on(table.analysisId, table.githubUser)],
);
