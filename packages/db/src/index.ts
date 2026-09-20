export { createDatabase, pingDatabase } from './client.js';
export type { Database, DatabaseOptions, Executor, Transaction } from './client.js';
export * from './schema.js';
export { claimDelivery, completeDelivery } from './queries/deliveries.js';
export type { DeliveryInput, DeliveryOutcome } from './queries/deliveries.js';
export {
  deleteInstallation,
  removeRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
} from './queries/installations.js';
export type { InstallationInput, RepositoryInput } from './queries/installations.js';
export { findRepositoryByGithubId, upsertFailure, upsertWorkflowRun } from './queries/runs.js';
export type { FailureInput, WorkflowRunInput } from './queries/runs.js';
export {
  countFailuresByFingerprint,
  findCachedAnalysis,
  insertAnalysis,
} from './queries/analyses.js';
export type { AnalysisInput, CacheLookupOptions, CachedAnalysis } from './queries/analyses.js';
export {
  findPrComment,
  findRunFailures,
  findWorkflowRun,
  upsertPrComment,
} from './queries/comments.js';
export type { FailureWithAnalysis, PrCommentInput } from './queries/comments.js';
export {
  findRepositoryByFullName,
  findRunByGithubId,
  getCategoryBreakdown,
  getFailuresPerDay,
  getOverviewStats,
  getRecurringFailures,
  listFlakyTests,
  listRepositories,
  listRuns,
  updateRepositorySettings,
} from './queries/dashboard.js';
export type {
  CategoryCount,
  DailyCount,
  OverviewStats,
  RecurringFailure,
  RepositorySummary,
  RunSummary,
} from './queries/dashboard.js';
export {
  countFailuresForRun,
  countFlakyCommits,
  deleteResultsForRuns,
  findFlakyTest,
  findKnownFlakyFailures,
  findResultsForSha,
  findRunIdsForSha,
  hasStoredResults,
  insertTestResults,
  recordFlakyTest,
} from './queries/tests.js';
export type { TestResultInput } from './queries/tests.js';
