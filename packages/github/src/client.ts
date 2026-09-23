import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { z } from 'zod';
import { listArtifactsResponseSchema, type Artifact } from './artifacts.js';
import { LogsUnavailableError, statusOf } from './errors.js';
import {
  checkRunsResponseSchema,
  listCommentsResponseSchema,
  listJobsResponseSchema,
  listPullFilesResponseSchema,
  listPullsResponseSchema,
  type IssueComment,
  type PullRequestFile,
  type PullRequestRef,
  type WorkflowJob,
  type CheckRunInput,
} from './schemas.js';

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface GitHubAppOptions {
  appId: number;
  privateKey: string;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
  /** Logs throttling warnings; defaults to silence. */
  onWarning?: (message: string) => void;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface InstallationClient {
  /** Jobs of the latest attempt of a run. */
  listRunJobs(params: RepoRef & { runId: number }): Promise<WorkflowJob[]>;
  /** Plain-text logs of one job. Throws {@link LogsUnavailableError} when GitHub has none. */
  downloadJobLogs(params: RepoRef & { jobId: number }): Promise<string>;
  /** Open pull requests whose head is this commit. Used when the webhook has none. */
  listPullRequestsForCommit(params: RepoRef & { sha: string }): Promise<PullRequestRef[]>;
  /** Comments on a pull request's conversation. */
  listIssueComments(params: RepoRef & { issueNumber: number }): Promise<IssueComment[]>;
  createIssueComment(params: RepoRef & { issueNumber: number; body: string }): Promise<number>;
  updateIssueComment(params: RepoRef & { commentId: number; body: string }): Promise<void>;
  /** Changed files of a pull request, for context. Never the full patch. */
  listPullRequestFiles(params: RepoRef & { pullNumber: number }): Promise<PullRequestFile[]>;
  /** Logsy's own check run for a commit, when it already made one. */
  findCheckRun(params: RepoRef & { headSha: string; name: string }): Promise<number | null>;
  /** Creates or updates a check run; the id is returned so the next run reuses it. */
  writeCheckRun(params: RepoRef & CheckRunInput): Promise<number>;
  /** Re-runs only the failed jobs of a run. Needs the Actions write permission. */
  rerunFailedJobs(params: RepoRef & { runId: number }): Promise<void>;
  /** Artifacts a run produced, including expired ones. */
  listRunArtifacts(params: RepoRef & { runId: number }): Promise<Artifact[]>;
  /** The artifact's zip. Throws {@link LogsUnavailableError} when it is gone. */
  downloadArtifact(params: RepoRef & { artifactId: number }): Promise<Uint8Array>;
  /** Rate limit reported by the most recent response, or null before the first call. */
  rateLimit(): RateLimitSnapshot | null;
}

export interface GitHubApp {
  forInstallation(installationId: number): Promise<InstallationClient>;
}

const LogsyOctokit = Octokit.plugin(retry, throttling);

export function createGitHubApp(options: GitHubAppOptions): GitHubApp {
  const warn = options.onWarning ?? (() => undefined);

  const app = new App({
    appId: options.appId,
    privateKey: options.privateKey,
    Octokit: LogsyOctokit.defaults({
      request: options.fetch ? { fetch: options.fetch } : {},
      throttle: {
        onRateLimit: (retryAfter: number, requestOptions: { method: string; url: string }) => {
          warn(`rate limited on ${requestOptions.method} ${requestOptions.url}`);
          // The job's own retry/backoff handles it; don't hold the worker slot.
          return false;
        },
        onSecondaryRateLimit: (
          retryAfter: number,
          requestOptions: { method: string; url: string },
        ) => {
          warn(`secondary rate limit on ${requestOptions.method} ${requestOptions.url}`);
          return false;
        },
      },
    }),
  });

  return {
    async forInstallation(installationId) {
      const octokit = await app.getInstallationOctokit(installationId);
      let rateLimit: RateLimitSnapshot | null = null;

      octokit.hook.after('request', (response: { headers: Record<string, unknown> }) => {
        rateLimit = readRateLimit(response.headers) ?? rateLimit;
      });

      return {
        rateLimit: () => rateLimit,

        async listRunJobs({ owner, repo, runId }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
            { owner, repo, run_id: runId, filter: 'latest', per_page: 100 },
          );
          return listJobsResponseSchema.parse(response.data).jobs;
        },

        async listPullRequestsForCommit({ owner, repo, sha }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
            { owner, repo, commit_sha: sha, per_page: 10 },
          );
          return listPullsResponseSchema.parse(response.data);
        },

        async listIssueComments({ owner, repo, issueNumber }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
            { owner, repo, issue_number: issueNumber, per_page: 100 },
          );
          return listCommentsResponseSchema.parse(response.data);
        },

        async createIssueComment({ owner, repo, issueNumber, body }) {
          const response = await octokit.request(
            'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
            { owner, repo, issue_number: issueNumber, body },
          );
          return z.object({ id: z.number().int().positive() }).parse(response.data).id;
        },

        async rerunFailedJobs({ owner, repo, runId }) {
          await octokit.request(
            'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
            { owner, repo, run_id: runId },
          );
        },

        async findCheckRun({ owner, repo, headSha, name }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
            { owner, repo, ref: headSha, check_name: name, per_page: 100 },
          );
          const parsed = checkRunsResponseSchema.parse(response.data);
          // Newest first: a re-analysis updates the check people are already looking at.
          return parsed.check_runs[0]?.id ?? null;
        },

        async writeCheckRun({ owner, repo, checkRunId, name, headSha, conclusion, output }) {
          const body = {
            owner,
            repo,
            name,
            head_sha: headSha,
            status: 'completed' as const,
            conclusion,
            completed_at: new Date().toISOString(),
            output,
          };
          const response =
            checkRunId === undefined
              ? await octokit.request('POST /repos/{owner}/{repo}/check-runs', body)
              : await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
                  ...body,
                  check_run_id: checkRunId,
                });
          return z.object({ id: z.number().int().positive() }).parse(response.data).id;
        },

        async updateIssueComment({ owner, repo, commentId, body }) {
          await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            owner,
            repo,
            comment_id: commentId,
            body,
          });
        },

        async listPullRequestFiles({ owner, repo, pullNumber }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
            { owner, repo, pull_number: pullNumber, per_page: 100 },
          );
          return listPullFilesResponseSchema.parse(response.data);
        },

        async listRunArtifacts({ owner, repo, runId }) {
          const response = await octokit.request(
            'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
            { owner, repo, run_id: runId, per_page: 100 },
          );
          return listArtifactsResponseSchema.parse(response.data).artifacts;
        },

        async downloadArtifact({ owner, repo, artifactId }) {
          // Same redirect-to-storage shape as job logs: follow it without the
          // Authorization header, which storage rejects.
          let location: string | undefined;
          try {
            const response = await octokit.request(
              'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
              {
                owner,
                repo,
                artifact_id: artifactId,
                archive_format: 'zip',
                request: { redirect: 'manual' },
              },
            );
            if (response.data instanceof ArrayBuffer) return new Uint8Array(response.data);
            location = headerValue(response.headers, 'location');
          } catch (error) {
            const status = statusOf(error);
            if (status === undefined || status < 300 || status >= 400) {
              throw status === undefined ? error : new LogsUnavailableError(artifactId, status);
            }
            location = redirectLocation(error);
          }

          if (location === undefined) throw new LogsUnavailableError(artifactId, 302);

          const fetchImpl = options.fetch ?? globalThis.fetch;
          const archive = await fetchImpl(location);
          if (!archive.ok) throw new LogsUnavailableError(artifactId, archive.status);
          return new Uint8Array(await archive.arrayBuffer());
        },

        async downloadJobLogs({ owner, repo, jobId }) {
          // GitHub answers with a 302 to a short-lived storage URL. The redirect must be
          // followed without the Authorization header, so it is handled manually.
          let location: string | undefined;
          try {
            const response = await octokit.request(
              'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
              { owner, repo, job_id: jobId, request: { redirect: 'manual' } },
            );
            rateLimit = readRateLimit(response.headers) ?? rateLimit;
            if (typeof response.data === 'string' && response.data.length > 0) {
              return response.data;
            }
            location = headerValue(response.headers, 'location');
          } catch (error) {
            const status = statusOf(error);
            if (status === undefined || status < 300 || status >= 400) {
              throw status !== undefined ? new LogsUnavailableError(jobId, status) : error;
            }
            location = redirectLocation(error);
          }

          if (location === undefined) throw new LogsUnavailableError(jobId, 302);

          const fetchImpl = options.fetch ?? globalThis.fetch;
          const logs = await fetchImpl(location);
          if (!logs.ok) throw new LogsUnavailableError(jobId, logs.status);
          return await logs.text();
        },
      };
    },
  };
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function redirectLocation(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const { response } = error as { response?: { headers?: Record<string, unknown> } };
    if (response?.headers) return headerValue(response.headers, 'location');
  }
  return undefined;
}

export function readRateLimit(headers: Record<string, unknown>): RateLimitSnapshot | null {
  const limit = Number(headers['x-ratelimit-limit']);
  const remaining = Number(headers['x-ratelimit-remaining']);
  const reset = Number(headers['x-ratelimit-reset']);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) {
    return null;
  }
  return { limit, remaining, resetAt: new Date(reset * 1000) };
}
