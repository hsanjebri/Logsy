import { COMMENT_MARKER } from '@logsy/core';
import { describe, expect, it } from 'vitest';
import type { InstallationClient } from './client.js';
import { COMMENT_MARKER_FALLBACK } from './constants.js';
import { findMarkedComment, resolvePullRequest, summarizeDiff } from './pull-requests.js';
import type { IssueComment, PullRequestFile, PullRequestRef } from './schemas.js';

function clientWithPulls(pulls: PullRequestRef[]): {
  client: InstallationClient;
  calls: number;
} {
  const state = { calls: 0 };
  const client = {
    listPullRequestsForCommit: () => {
      state.calls += 1;
      return Promise.resolve(pulls);
    },
  } as unknown as InstallationClient;
  return {
    client,
    get calls() {
      return state.calls;
    },
  };
}

describe('resolvePullRequest', () => {
  it('uses the number from the webhook without calling the API', async () => {
    const stub = clientWithPulls([{ number: 99 }]);

    const number = await resolvePullRequest(stub.client, {
      owner: 'acme',
      repo: 'api',
      headSha: 'abc',
      fromPayload: [7],
    });

    expect(number).toBe(7);
    expect(stub.calls).toBe(0);
  });

  it('falls back to the commit’s pull requests, which is the fork case', async () => {
    const stub = clientWithPulls([
      { number: 4, state: 'closed' },
      { number: 12, state: 'open' },
    ]);

    const number = await resolvePullRequest(stub.client, {
      owner: 'acme',
      repo: 'api',
      headSha: 'abc',
      fromPayload: [],
    });

    // The open one wins over a closed one.
    expect(number).toBe(12);
    expect(stub.calls).toBe(1);
  });

  it('returns null for a push with no pull request at all', async () => {
    const stub = clientWithPulls([]);

    await expect(
      resolvePullRequest(stub.client, {
        owner: 'acme',
        repo: 'api',
        headSha: 'abc',
        fromPayload: [],
      }),
    ).resolves.toBeNull();
  });
});

describe('findMarkedComment', () => {
  const comments: IssueComment[] = [
    { id: 1, body: 'nice work', user: { login: 'reviewer', type: 'User' } },
    {
      id: 2,
      body: `${COMMENT_MARKER_FALLBACK}\n\n### CI failed`,
      user: { login: 'logsy', type: 'Bot' },
    },
    { id: 3, body: null, user: null },
  ];

  it('finds Logsy’s own comment by the hidden marker', () => {
    expect(findMarkedComment(comments)?.id).toBe(2);
  });

  it('returns nothing when no comment carries the marker', () => {
    const unmarked = comments.filter((comment) => comment.id !== 2);
    expect(findMarkedComment(unmarked)).toBeUndefined();
  });

  it('uses the same marker as the formatter in core', () => {
    expect(COMMENT_MARKER_FALLBACK).toBe(COMMENT_MARKER);
  });
});

describe('summarizeDiff', () => {
  const files: PullRequestFile[] = [
    { filename: 'src/app.ts', status: 'modified', additions: 12, deletions: 3 },
    { filename: 'package.json', status: 'modified', additions: 1, deletions: 1 },
  ];

  it('lists file names and line counts, never the patch', () => {
    expect(summarizeDiff(files)).toBe(
      'src/app.ts (modified, +12 -3)\npackage.json (modified, +1 -1)',
    );
  });

  it('caps a large diff and says how much was left out', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      filename: `src/file-${String(index)}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
    }));

    const summary = summarizeDiff(many, { maxFiles: 5 });

    expect(summary.split('\n')).toHaveLength(6);
    expect(summary).toContain('… and 35 more files');
  });

  it('handles an empty diff', () => {
    expect(summarizeDiff([])).toBe('No files changed.');
  });
});
