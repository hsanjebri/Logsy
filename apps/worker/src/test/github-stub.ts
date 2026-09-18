import type { GitHubApp, InstallationClient, RateLimitSnapshot, WorkflowJob } from '@logsy/github';
import { LogsUnavailableError } from '@logsy/github';

export interface GitHubStubOptions {
  jobs: WorkflowJob[];
  logs?: Record<number, string>;
  /** Job ids whose logs GitHub no longer has. */
  missingLogs?: number[];
  rateLimit?: RateLimitSnapshot;
}

export interface GitHubStub extends GitHubApp {
  downloadedJobIds: number[];
}

export function githubStub(options: GitHubStubOptions): GitHubStub {
  const downloadedJobIds: number[] = [];

  const client: InstallationClient = {
    listRunJobs: () => Promise.resolve(options.jobs),
    downloadJobLogs: ({ jobId }) => {
      downloadedJobIds.push(jobId);
      if (options.missingLogs?.includes(jobId)) {
        return Promise.reject(new LogsUnavailableError(jobId, 410));
      }
      return Promise.resolve(options.logs?.[jobId] ?? '');
    },
    rateLimit: () => options.rateLimit ?? null,
  };

  return {
    downloadedJobIds,
    forInstallation: () => Promise.resolve(client),
  };
}

export function workflowJob(
  overrides: Partial<WorkflowJob> & Pick<WorkflowJob, 'id'>,
): WorkflowJob {
  return {
    run_id: 42,
    run_attempt: 1,
    name: `job-${overrides.id}`,
    status: 'completed',
    conclusion: 'failure',
    html_url: `https://github.com/acme/api/actions/runs/42/job/${overrides.id}`,
    started_at: '2026-09-18T10:00:00Z',
    completed_at: '2026-09-18T10:05:00Z',
    steps: [
      { name: 'Install', status: 'completed', conclusion: 'success', number: 1 },
      { name: 'Run tests', status: 'completed', conclusion: 'failure', number: 2 },
    ],
    ...overrides,
  };
}
