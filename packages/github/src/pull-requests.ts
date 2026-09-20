import type { InstallationClient, RepoRef } from './client.js';
import { COMMENT_MARKER_FALLBACK } from './constants.js';
import type { IssueComment, PullRequestFile, PullRequestRef } from './schemas.js';

/**
 * The pull request a run belongs to. `workflow_run.pull_requests` is empty for runs
 * from forks, so the commit's pull requests are the fallback.
 */
export async function resolvePullRequest(
  client: InstallationClient,
  params: RepoRef & { headSha: string; fromPayload: readonly number[] },
): Promise<number | null> {
  const [first] = params.fromPayload;
  if (first !== undefined) return first;

  const pulls = await client.listPullRequestsForCommit({
    owner: params.owner,
    repo: params.repo,
    sha: params.headSha,
  });
  const open = pulls.find((pull: PullRequestRef) => pull.state !== 'closed');
  return open?.number ?? pulls[0]?.number ?? null;
}

/** Logsy's own comment on a pull request, found by the hidden marker. */
export function findMarkedComment(
  comments: readonly IssueComment[],
  marker: string = COMMENT_MARKER_FALLBACK,
): IssueComment | undefined {
  return comments.find((comment) => comment.body?.includes(marker) === true);
}

export interface DiffSummaryOptions {
  /** Files listed before the summary is truncated. */
  maxFiles?: number;
}

/**
 * A short, plain-text summary of a pull request's changes: file names and line
 * counts only, never the patch, so the LLM gets context without the whole diff.
 */
export function summarizeDiff(
  files: readonly PullRequestFile[],
  options: DiffSummaryOptions = {},
): string {
  const maxFiles = options.maxFiles ?? 25;
  if (files.length === 0) return 'No files changed.';

  const shown = files.slice(0, maxFiles);
  const lines = shown.map(
    (file) =>
      `${file.filename} (${file.status}, +${String(file.additions)} -${String(file.deletions)})`,
  );
  if (files.length > shown.length) {
    lines.push(`… and ${String(files.length - shown.length)} more files`);
  }
  return lines.join('\n');
}
