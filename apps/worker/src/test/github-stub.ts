import type {
  Artifact,
  GitHubApp,
  InstallationClient,
  IssueComment,
  PullRequestFile,
  PullRequestRef,
  RateLimitSnapshot,
  WorkflowJob,
} from '@logsy/github';
import { LogsUnavailableError } from '@logsy/github';

export interface GitHubStubOptions {
  jobs?: WorkflowJob[];
  logs?: Record<number, string>;
  /** Job ids whose logs GitHub no longer has. */
  missingLogs?: number[];
  rateLimit?: RateLimitSnapshot;
  /** Pull requests the commit belongs to, when the webhook carried none. */
  pullsForCommit?: PullRequestRef[];
  /** Comments already on the pull request. */
  comments?: IssueComment[];
  files?: PullRequestFile[];
  /** Artifacts the run produced. */
  artifacts?: Artifact[];
  /** Artifact id to the zip bytes it downloads as; a missing id is an expired artifact. */
  artifactZips?: Record<number, Uint8Array>;
}

export interface CommentCall {
  kind: 'create' | 'update';
  id: number;
  body: string;
}

export interface GitHubStub extends GitHubApp {
  downloadedJobIds: number[];
  commentCalls: CommentCall[];
}

export function githubStub(options: GitHubStubOptions = {}): GitHubStub {
  const downloadedJobIds: number[] = [];
  const commentCalls: CommentCall[] = [];
  const comments = [...(options.comments ?? [])];
  let nextCommentId = 9_000;

  const client: InstallationClient = {
    listRunJobs: () => Promise.resolve(options.jobs ?? []),
    downloadJobLogs: ({ jobId }) => {
      downloadedJobIds.push(jobId);
      if (options.missingLogs?.includes(jobId)) {
        return Promise.reject(new LogsUnavailableError(jobId, 410));
      }
      return Promise.resolve(options.logs?.[jobId] ?? '');
    },
    listPullRequestsForCommit: () => Promise.resolve(options.pullsForCommit ?? []),
    listIssueComments: () => Promise.resolve([...comments]),
    createIssueComment: ({ body }) => {
      const id = nextCommentId++;
      comments.push({ id, body, user: { login: 'logsy-dev', type: 'Bot' } });
      commentCalls.push({ kind: 'create', id, body });
      return Promise.resolve(id);
    },
    updateIssueComment: ({ commentId, body }) => {
      const existing = comments.find((comment) => comment.id === commentId);
      if (existing) existing.body = body;
      commentCalls.push({ kind: 'update', id: commentId, body });
      return Promise.resolve();
    },
    listPullRequestFiles: () => Promise.resolve(options.files ?? []),
    listRunArtifacts: () => Promise.resolve(options.artifacts ?? []),
    downloadArtifact: ({ artifactId }) => {
      const zip = options.artifactZips?.[artifactId];
      if (!zip) return Promise.reject(new LogsUnavailableError(artifactId, 410));
      return Promise.resolve(zip);
    },
    rateLimit: () => options.rateLimit ?? null,
  };

  return {
    downloadedJobIds,
    commentCalls,
    forInstallation: () => Promise.resolve(client),
  };
}

export function workflowJob(
  overrides: Partial<WorkflowJob> & Pick<WorkflowJob, 'id'>,
): WorkflowJob {
  return {
    run_id: 42,
    run_attempt: 1,
    name: `job-${String(overrides.id)}`,
    status: 'completed',
    conclusion: 'failure',
    html_url: `https://github.com/acme/api/actions/runs/42/job/${String(overrides.id)}`,
    started_at: '2026-09-18T10:00:00Z',
    completed_at: '2026-09-18T10:05:00Z',
    steps: [
      { name: 'Install', status: 'completed', conclusion: 'success', number: 1 },
      { name: 'Run tests', status: 'completed', conclusion: 'failure', number: 2 },
    ],
    ...overrides,
  };
}
