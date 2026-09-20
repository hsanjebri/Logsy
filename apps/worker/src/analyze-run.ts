import {
  extractFailureContext,
  fingerprint,
  matchRule,
  redactSecrets,
  ruleToAnalysis,
  type AnalysisResult,
} from '@logsy/core';
import {
  findCachedAnalysis,
  findRepositoryByGithubId,
  insertAnalysis,
  upsertFailure,
  upsertWorkflowRun,
  type Database,
} from '@logsy/db';
import { LogsUnavailableError, failedStep, isFailedJob, type GitHubApp } from '@logsy/github';
import type { AnalysisInput, LlmProvider } from '@logsy/llm';
import type { AnalyzeRunJob, PostCommentQueue } from '@logsy/queue';
import type { Logger } from 'pino';

export interface AnalyzeRunDeps {
  db: Database;
  github: GitHubApp;
  log: Logger;
  /** Optional: when absent, failures with no rule are left unexplained. */
  llm?: LlmProvider;
  /** Optional: when absent, analyses are stored but no comment is queued. */
  comments?: Pick<PostCommentQueue, 'enqueuePostComment'>;
  /** Defer the job when fewer than this many API requests remain. */
  rateLimitFloor?: number;
}

export interface AnalyzeRunResult {
  status: 'analyzed' | 'no-failed-jobs' | 'unknown-repository';
  failedJobs: number;
  logChars: number;
  /** Where each failure's analysis came from, in job order. */
  analyses: AnalysisSource[];
  /** Set when the run should be retried after the rate limit resets. */
  retryAt?: Date;
}

/** `none` means nothing could explain it: no cache, no rule, and no LLM available. */
export type AnalysisSource = 'cache' | 'rule' | 'llm' | 'none';

/** Character budget for the stored excerpt, roughly 3k tokens. */
const EXCERPT_MAX_CHARS = 12_000;

export async function processAnalyzeRun(
  deps: AnalyzeRunDeps,
  job: AnalyzeRunJob,
): Promise<AnalyzeRunResult> {
  const { db, github } = deps;
  const log = deps.log.child({ runId: job.runId, runAttempt: job.runAttempt, repo: job.repo });

  const repository = await findRepositoryByGithubId(db, job.githubRepoId);
  if (!repository) {
    log.warn('repository is not installed; dropping job');
    return { status: 'unknown-repository', failedJobs: 0, logChars: 0, analyses: [] };
  }

  const client = await github.forInstallation(job.installationId);
  const jobs = await client.listRunJobs({ owner: job.owner, repo: job.repo, runId: job.runId });

  const rateLimit = client.rateLimit();
  const floor = deps.rateLimitFloor ?? 100;
  if (rateLimit && rateLimit.remaining < floor) {
    log.warn({ remaining: rateLimit.remaining }, 'GitHub rate limit low; deferring run');
    return {
      status: 'analyzed',
      failedJobs: 0,
      logChars: 0,
      analyses: [],
      retryAt: rateLimit.resetAt,
    };
  }

  const workflowRunId = await upsertWorkflowRun(db, {
    repositoryId: repository.id,
    githubRunId: job.runId,
    runAttempt: job.runAttempt,
    workflowName: job.workflowName,
    headSha: job.headSha,
    headBranch: job.headBranch,
    event: job.event,
    conclusion: job.conclusion,
    prNumber: job.prNumbers[0] ?? null,
    htmlUrl: job.htmlUrl,
  });

  const failedJobs = jobs.filter(isFailedJob);
  if (failedJobs.length === 0) {
    log.info('run failed but no job reported a failure');
    return { status: 'no-failed-jobs', failedJobs: 0, logChars: 0, analyses: [] };
  }

  let logChars = 0;
  const analyses: AnalysisSource[] = [];
  for (const failed of failedJobs) {
    let logs = '';
    try {
      logs = await client.downloadJobLogs({ owner: job.owner, repo: job.repo, jobId: failed.id });
    } catch (error) {
      if (!(error instanceof LogsUnavailableError)) throw error;
      log.warn({ jobId: failed.id, status: error.status }, 'job logs unavailable');
    }
    logChars += logs.length;

    // Locates the real error region, trims it to budget and redacts it.
    // Redaction runs before anything is stored.
    const context = extractFailureContext(logs, { maxChars: EXCERPT_MAX_CHARS });
    // GitHub's own step name is more reliable than the one parsed out of the log.
    const stepName = failedStep(failed)?.name ?? context.stepName;
    const excerpt = logs === '' ? '' : redactSecrets(context.excerpt);
    const errorFingerprint = fingerprint({
      normalizedError: context.normalizedError,
      stepName,
    });

    // Rules decide the category; the LLM may refine it in Phase 5.
    const ruleMatch = excerpt === '' ? undefined : matchRule(excerpt);

    const failureId = await upsertFailure(db, {
      workflowRunId,
      githubJobId: failed.id,
      jobName: failed.name,
      stepName,
      category: ruleMatch?.rule.category ?? 'unknown',
      fingerprint: errorFingerprint,
      errorExcerpt: excerpt,
      logCharsOriginal: logs.length,
      logCharsTrimmed: excerpt.length,
    });

    const source = await analyzeFailure(
      { db, log, ...(deps.llm ? { llm: deps.llm } : {}) },
      {
        failureId,
        fingerprint: errorFingerprint,
        ruleMatch,
        llmEnabled: repository.settings.llmEnabled,
        llmInput: {
          excerpt,
          repoFullName: repository.fullName,
          workflowName: job.workflowName,
          jobName: failed.name,
          stepName,
        },
      },
    );
    analyses.push(source);

    log.info(
      {
        jobId: failed.id,
        jobName: failed.name,
        stepName,
        logChars: logs.length,
        excerptChars: excerpt.length,
        fingerprint: errorFingerprint,
        anchor: context.region?.anchors[0]?.patternId ?? null,
        priority: context.region?.priority ?? null,
        analysis: source,
        ruleId: ruleMatch?.rule.id ?? null,
      },
      'stored failure',
    );
  }

  // Commenting is its own job: a GitHub outage retries the comment, never the analysis.
  if (deps.comments) {
    await deps.comments.enqueuePostComment({
      installationId: job.installationId,
      githubRepoId: job.githubRepoId,
      owner: job.owner,
      repo: job.repo,
      runId: job.runId,
      runAttempt: job.runAttempt,
      workflowName: job.workflowName,
      headSha: job.headSha,
      htmlUrl: job.htmlUrl,
      prNumbers: job.prNumbers,
      mode: 'failure',
    });
    log.info('queued post-comment');
  }

  return { status: 'analyzed', failedJobs: failedJobs.length, logChars, analyses };
}

interface AnalyzeFailureInput {
  failureId: number;
  fingerprint: string;
  ruleMatch: ReturnType<typeof matchRule>;
  /** Given to the model when no rule matched. */
  llmInput: AnalysisInput;
  llmEnabled: boolean;
}

/**
 * Explains one failure as cheaply as possible: reuse a previous analysis of the same
 * fingerprint, else apply a rule, and only then pay for an LLM call.
 */
async function analyzeFailure(
  deps: Pick<AnalyzeRunDeps, 'db' | 'llm' | 'log'>,
  {
    failureId,
    fingerprint: fingerprintValue,
    ruleMatch,
    llmInput,
    llmEnabled,
  }: AnalyzeFailureInput,
): Promise<AnalysisSource> {
  const { db } = deps;
  const cached = await findCachedAnalysis(db, fingerprintValue);
  if (cached) {
    await insertAnalysis(db, {
      failureId,
      fingerprint: fingerprintValue,
      source: 'cache',
      result: cached.result,
      confidence: cached.confidence,
      model: cached.model,
      promptVersion: cached.promptVersion,
    });
    return 'cache';
  }

  if (ruleMatch) {
    const result: AnalysisResult = ruleToAnalysis(ruleMatch);
    await insertAnalysis(db, {
      failureId,
      fingerprint: fingerprintValue,
      source: 'rule',
      ruleId: ruleMatch.rule.id,
      result,
      confidence: result.confidence,
    });
    return 'rule';
  }

  if (!deps.llm || !llmEnabled || llmInput.excerpt === '') {
    return 'none';
  }

  const analysis = await deps.llm.analyze(llmInput);
  await insertAnalysis(db, {
    failureId,
    fingerprint: fingerprintValue,
    source: 'llm',
    provider: deps.llm.name,
    model: analysis.model,
    promptVersion: analysis.promptVersion,
    result: analysis.result,
    confidence: analysis.result.confidence,
    inputTokens: analysis.usage.inputTokens,
    outputTokens: analysis.usage.outputTokens,
    costUsd: analysis.usage.costUsd,
    latencyMs: analysis.latencyMs,
  });

  deps.log.info(
    {
      model: analysis.model,
      attempts: analysis.attempts,
      fellBack: analysis.fellBack,
      inputTokens: analysis.usage.inputTokens,
      outputTokens: analysis.usage.outputTokens,
      costUsd: analysis.usage.costUsd,
      latencyMs: analysis.latencyMs,
      confidence: analysis.result.confidence,
    },
    'llm analysis stored',
  );
  return 'llm';
}
