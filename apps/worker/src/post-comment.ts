import {
  COMMENT_MARKER,
  formatFailureComment,
  formatPassingComment,
  type AnalysisResult,
  type CommentContext,
} from '@logsy/core';
import {
  countFailuresByFingerprint,
  findRepositoryByGithubId,
  findRunFailures,
  findWorkflowRun,
  upsertPrComment,
  type Database,
  type FailureWithAnalysis,
} from '@logsy/db';
import { findMarkedComment, resolvePullRequest, type GitHubApp } from '@logsy/github';
import type { PostCommentJob } from '@logsy/queue';
import type { Logger } from 'pino';

export interface PostCommentDeps {
  db: Database;
  github: GitHubApp;
  log: Logger;
  /** Base URL of this Logsy instance, used for the feedback links. */
  feedbackBaseUrl?: string;
}

export interface PostCommentResult {
  status: 'created' | 'updated' | 'resolved' | 'skipped';
  reason?:
    | 'no-pull-request'
    | 'no-failures'
    | 'comments-disabled'
    | 'unknown-repository'
    | 'nothing-to-resolve';
  prNumber?: number;
  commentId?: number;
}

/**
 * Posts or updates the single comment for a run. The comment is found by its hidden
 * marker, so a re-run edits the existing one instead of adding another.
 */
export async function processPostComment(
  deps: PostCommentDeps,
  job: PostCommentJob,
): Promise<PostCommentResult> {
  const { db, github } = deps;
  const log = deps.log.child({ runId: job.runId, repo: job.repo, mode: job.mode });

  const repository = await findRepositoryByGithubId(db, job.githubRepoId);
  if (!repository) {
    log.warn('repository is not installed; dropping comment job');
    return { status: 'skipped', reason: 'unknown-repository' };
  }
  if (repository.settings.commentMode === 'off') {
    log.info('commenting disabled for repository');
    return { status: 'skipped', reason: 'comments-disabled' };
  }

  const client = await github.forInstallation(job.installationId);
  const prNumber = await resolvePullRequest(client, {
    owner: job.owner,
    repo: job.repo,
    headSha: job.headSha,
    fromPayload: job.prNumbers,
  });
  if (prNumber === null) {
    // A push straight to a branch: the analysis is stored, there is just nowhere to say it.
    log.info('run has no pull request; analysis stored without a comment');
    return { status: 'skipped', reason: 'no-pull-request' };
  }

  const existing = findMarkedComment(
    await client.listIssueComments({ owner: job.owner, repo: job.repo, issueNumber: prNumber }),
    COMMENT_MARKER,
  );

  const run = await findWorkflowRun(db, job.runId, job.runAttempt);

  if (job.mode === 'resolved') {
    if (!existing) {
      log.debug('nothing to resolve: no earlier comment on this pull request');
      return { status: 'skipped', reason: 'nothing-to-resolve', prNumber };
    }
    await client.updateIssueComment({
      owner: job.owner,
      repo: job.repo,
      commentId: existing.id,
      body: formatPassingComment({
        workflowName: job.workflowName,
        runUrl: job.htmlUrl,
        headSha: job.headSha,
      }),
    });
    await upsertPrComment(db, {
      repositoryId: repository.id,
      prNumber,
      githubCommentId: existing.id,
      lastRunId: run?.id ?? null,
    });
    log.info({ prNumber, commentId: existing.id }, 'comment resolved');
    return { status: 'resolved', prNumber, commentId: existing.id };
  }

  if (!run) {
    log.warn('run not stored; nothing to comment about');
    return { status: 'skipped', reason: 'no-failures', prNumber };
  }

  const failures = await findRunFailures(db, run.id);
  const [firstFailure, ...restFailures] = failures;
  if (!firstFailure) {
    log.info('no stored failures for this run');
    return { status: 'skipped', reason: 'no-failures', prNumber };
  }

  // One comment per pull request: the worst failure leads, the rest are listed under it.
  const primary = pickPrimary([firstFailure, ...restFailures]);
  const seenCount = await countFailuresByFingerprint(db, repository.id, primary.fingerprint);

  const context: CommentContext = {
    analysis: primary.result ?? unexplained(primary),
    source: primary.source ?? 'rule',
    repoFullName: repository.fullName,
    workflowName: job.workflowName,
    jobName: primary.jobName,
    stepName: primary.stepName,
    runUrl: job.htmlUrl,
    errorExcerpt: primary.errorExcerpt,
    seenCount,
    headSha: job.headSha,
    prNumber,
    model: primary.model,
    ...(deps.feedbackBaseUrl !== undefined && primary.analysisId !== null
      ? { feedbackBaseUrl: deps.feedbackBaseUrl, analysisId: primary.analysisId }
      : {}),
  };

  const body = formatFailureComment(context) + otherFailures(failures, primary);

  if (existing) {
    await client.updateIssueComment({
      owner: job.owner,
      repo: job.repo,
      commentId: existing.id,
      body,
    });
    await upsertPrComment(db, {
      repositoryId: repository.id,
      prNumber,
      githubCommentId: existing.id,
      lastRunId: run.id,
    });
    log.info({ prNumber, commentId: existing.id }, 'comment updated');
    return { status: 'updated', prNumber, commentId: existing.id };
  }

  const commentId = await client.createIssueComment({
    owner: job.owner,
    repo: job.repo,
    issueNumber: prNumber,
    body,
  });
  await upsertPrComment(db, {
    repositoryId: repository.id,
    prNumber,
    githubCommentId: commentId,
    lastRunId: run.id,
  });
  log.info({ prNumber, commentId }, 'comment created');
  return { status: 'created', prNumber, commentId };
}

/**
 * The failure worth leading with: the most confident explanation, else the first.
 * Callers only invoke this with a non-empty list.
 */
function pickPrimary(
  failures: readonly [FailureWithAnalysis, ...FailureWithAnalysis[]],
): FailureWithAnalysis {
  const explained = failures
    .filter((failure) => failure.result !== null)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return explained[0] ?? failures[0];
}

/** A short list of the other failed jobs, so nothing is silently hidden. */
function otherFailures(
  failures: readonly FailureWithAnalysis[],
  primary: FailureWithAnalysis,
): string {
  const others = failures.filter((failure) => failure.failureId !== primary.failureId);
  if (others.length === 0) return '';

  const lines = others
    .slice(0, 5)
    .map((failure) => `- **${failure.jobName}** — ${failure.result?.title ?? 'no explanation'}`);
  if (others.length > 5) lines.push(`- … and ${String(others.length - 5)} more failed jobs`);

  return `\n\n<details>\n<summary>${String(others.length)} other failed job${
    others.length === 1 ? '' : 's'
  }</summary>\n\n${lines.join('\n')}\n</details>`;
}

function unexplained(failure: FailureWithAnalysis): AnalysisResult {
  return {
    category: failure.category,
    title: 'CI failed',
    rootCause: '',
    evidence: [],
    likelyFiles: [],
    suggestedFix: '',
    isLikelyFlaky: false,
    confidence: 0,
  };
}
