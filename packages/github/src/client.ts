import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { LogsUnavailableError, statusOf } from './errors.js';
import { listJobsResponseSchema, type WorkflowJob } from './schemas.js';

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
