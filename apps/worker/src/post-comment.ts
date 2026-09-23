import {
  COMMENT_MARKER,
  buildAnnotations,
  categoryLabel,
  checkRunSummary,
  checkRunTitle,
  flakyNote,
  formatFailureComment,
  formatPassingComment,
  type AnalysisResult,
  type CommentContext,
  type FailureCategory,
  type SimilarFailureRef,
} from '@logsy/core';
import {
  countFailuresByFingerprint,
  findKnownFlakyFailures,
  findSimilarFailures,
  findRepositoryByGithubId,
  findRunFailures,
  findWorkflowRun,
  upsertPrComment,
  type Database,
  type FailureWithAnalysis,
} from '@logsy/db';
import {
  findMarkedComment,
  resolvePullRequest,
  type GitHubApp,
  type InstallationClient,
} from '@logsy/github';
import type { EmbeddingProvider } from '@logsy/llm';
import type { PostCommentJob } from '@logsy/queue';
import type { Logger } from 'pino';

export interface PostCommentDeps {
  db: Database;
  github: GitHubApp;
  log: Logger;
  /** Base URL of this Logsy instance, used for the feedback links. */
  feedbackBaseUrl?: string;
  /** Optional: without it, the comment cannot recall failures that only look alike. */
  embeddings?: EmbeddingProvider;
  /** Cosine similarity an older failure must reach to be mentioned. */
  minSimilarity?: number;
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
  // A known flaky test that failed here is worth saying out loud: it saves the
  // developer hunting for a bug in their own change.
  const [knownFlaky] = await findKnownFlakyFailures(db, repository.id, run.id);

  // A flaky failure is worth re-running once, before a person goes looking for a bug
  // in their own change. Only on the first attempt: the re-run is attempt two, so this
  // can never loop, whatever the second attempt concludes.
  const rerunNote = await maybeRerun(
    { client, log },
    {
      owner: job.owner,
      repo: job.repo,
      runId: job.runId,
      enabled: repository.settings.autoRerun === true,
      firstAttempt: run.runAttempt === 1,
      looksFlaky: primary.result?.isLikelyFlaky === true || knownFlaky !== undefined,
    },
  );

  // Older failures that mean the same thing, which fingerprints alone never match.
  const similar = await findSimilar(deps, {
    repositoryId: repository.id,
    fingerprint: primary.fingerprint,
    excerpt: primary.errorExcerpt,
  });

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
    ...(knownFlaky ? { flakyNote: flakyNote(knownFlaky) } : {}),
    ...(rerunNote === null ? {} : { rerunNote }),
    ...(similar.length > 0 ? { similar } : {}),
    ...(deps.feedbackBaseUrl !== undefined && primary.analysisId !== null
      ? { feedbackBaseUrl: deps.feedbackBaseUrl, analysisId: primary.analysisId }
      : {}),
  };

  const body = formatFailureComment(context) + otherFailures(failures, primary);

  // The check run puts the same explanation on the lines of the diff. It never fails
  // the pull request: Logsy explains failures, it does not add new ones.
  if (repository.settings.checksEnabled !== false) {
    await publishCheckRun(
      { client, log },
      {
        owner: job.owner,
        repo: job.repo,
        headSha: job.headSha,
        prNumber,
        context,
        body,
      },
    );
  }

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

const CHECK_RUN_NAME = 'Logsy';

interface CheckRunRequest {
  owner: string;
  repo: string;
  headSha: string;
  prNumber: number;
  context: CommentContext;
  body: string;
}

/** Publishes the analysis as a check run, annotating the files the PR changed. */
async function publishCheckRun(
  deps: { client: InstallationClient; log: Logger },
  request: CheckRunRequest,
): Promise<void> {
  const { client, log } = deps;
  const { owner, repo, headSha } = request;

  try {
    const files = await client.listPullRequestFiles({
      owner,
      repo,
      pullNumber: request.prNumber,
    });
    const annotationContext = {
      analysis: request.context.analysis,
      changedFiles: files.map((file) => file.filename),
      jobName: request.context.jobName,
      stepName: request.context.stepName,
    };
    const existing = await client.findCheckRun({ owner, repo, headSha, name: CHECK_RUN_NAME });
    const annotations = buildAnnotations(annotationContext);

    const checkRunId = await client.writeCheckRun({
      owner,
      repo,
      ...(existing === null ? {} : { checkRunId: existing }),
      name: CHECK_RUN_NAME,
      headSha,
      conclusion: 'neutral',
      output: {
        title: checkRunTitle(request.context.analysis),
        summary: checkRunSummary(annotationContext),
        text: request.body,
        ...(annotations.length > 0 ? { annotations } : {}),
      },
    });
    log.info({ checkRunId, annotations: annotations.length }, 'check run published');
  } catch (error) {
    // A missing checks:write permission must not cost the comment that already posted.
    log.warn({ err: error }, 'could not publish the check run');
  }
}

interface RerunRequest {
  owner: string;
  repo: string;
  runId: number;
  enabled: boolean;
  firstAttempt: boolean;
  looksFlaky: boolean;
}

/**
 * Re-runs the failed jobs when every guard agrees, and returns the line for the
 * comment. Returns null when nothing was re-run, including when GitHub refused.
 */
async function maybeRerun(
  deps: { client: InstallationClient; log: Logger },
  request: RerunRequest,
): Promise<string | null> {
  if (!request.enabled || !request.firstAttempt || !request.looksFlaky) return null;

  try {
    await deps.client.rerunFailedJobs({
      owner: request.owner,
      repo: request.repo,
      runId: request.runId,
    });
    deps.log.info({ runId: request.runId }, 'failed jobs re-run: the failure looks flaky');
    return 'This looks flaky, so Logsy re-ran the failed jobs once. Watch the new attempt before digging in.';
  } catch (error) {
    // Usually a missing Actions write permission; the comment simply omits the line.
    deps.log.warn({ err: error }, 'could not re-run the failed jobs');
    return null;
  }
}

/**
 * Asks the vector store for failures that mean the same thing as this one. Anything
 * that goes wrong here is worth a line in the log and nothing more: the comment is
 * complete without it.
 */
async function findSimilar(
  deps: PostCommentDeps,
  request: { repositoryId: number; fingerprint: string; excerpt: string },
): Promise<SimilarFailureRef[]> {
  if (!deps.embeddings || request.excerpt.trim() === '') return [];

  try {
    const matches = await findSimilarFailures(deps.db, {
      repositoryId: request.repositoryId,
      fingerprint: request.fingerprint,
      embedding: await deps.embeddings.embed(request.excerpt),
      ...(deps.minSimilarity === undefined ? {} : { minSimilarity: deps.minSimilarity }),
    });
    return matches.map((match) => ({
      title: match.title ?? categoryLabel(match.category as FailureCategory),
      runUrl: match.runUrl,
      similarity: match.similarity,
      prNumber: match.prNumber,
      seenAt: match.lastSeenAt,
    }));
  } catch (error) {
    deps.log.warn({ err: error }, 'could not look for similar failures');
    return [];
  }
}
