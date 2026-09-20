import { COMMENT_MARKER } from '@logsy/core';
import {
  createDatabase,
  prComments,
  repositories,
  upsertInstallation,
  upsertRepositories,
} from '@logsy/db';
import { truncateAll } from '@logsy/db/testing';
import type { AnalyzeRunJob, PostCommentJob } from '@logsy/queue';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { processAnalyzeRun } from './analyze-run.js';
import { processPostComment } from './post-comment.js';
import { githubStub, workflowJob, type GitHubStubOptions } from './test/github-stub.js';

const { db, pool } = createDatabase(inject('databaseUrl'));
const log = pino({ level: 'silent' });

afterAll(() => pool.end());

const GITHUB_REPO_ID = 900_000_001;
const RUN_ID = 42_000_000_000;

const analyzeJob: AnalyzeRunJob = {
  installationId: 51_234_567,
  githubRepoId: GITHUB_REPO_ID,
  owner: 'acme',
  repo: 'api',
  runId: RUN_ID,
  runAttempt: 1,
  workflowName: 'CI',
  headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
  headBranch: 'feat/queue',
  event: 'pull_request',
  conclusion: 'failure',
  htmlUrl: `https://github.com/acme/api/actions/runs/${String(RUN_ID)}`,
  prNumbers: [7],
};

const commentJob: PostCommentJob = {
  installationId: analyzeJob.installationId,
  githubRepoId: GITHUB_REPO_ID,
  owner: 'acme',
  repo: 'api',
  runId: RUN_ID,
  runAttempt: 1,
  workflowName: 'CI',
  headSha: analyzeJob.headSha,
  htmlUrl: analyzeJob.htmlUrl,
  prNumbers: [7],
  mode: 'failure',
};

const eresolveLog = [
  '##[group]Run npm ci',
  'npm ci',
  '##[endgroup]',
  'npm ERR! code ERESOLVE',
  'npm ERR! ERESOLVE unable to resolve dependency tree',
  '##[error]Process completed with exit code 1.',
].join('\n');

beforeEach(async () => {
  await truncateAll(db);
  const installationId = await upsertInstallation(db, {
    githubInstallationId: analyzeJob.installationId,
    accountLogin: 'acme',
    accountType: 'Organization',
  });
  await upsertRepositories(db, installationId, [
    { githubRepoId: GITHUB_REPO_ID, fullName: 'acme/api', private: false },
  ]);
});

/** Runs the analysis first, so the comment job has stored failures to describe. */
async function analyzeThenComment(
  options: GitHubStubOptions = {},
  job: PostCommentJob = commentJob,
) {
  const github = githubStub({
    jobs: [workflowJob({ id: 102, name: 'build (22)' })],
    logs: { 102: eresolveLog },
    ...options,
  });
  await processAnalyzeRun({ db, github, log }, analyzeJob);
  const result = await processPostComment({ db, github, log }, job);
  return { github, result };
}

describe('processPostComment', () => {
  it('creates one comment carrying the hidden marker', async () => {
    const { github, result } = await analyzeThenComment();

    expect(result).toMatchObject({ status: 'created', prNumber: 7 });
    expect(github.commentCalls).toHaveLength(1);
    const [call] = github.commentCalls;
    expect(call?.kind).toBe('create');
    expect(call?.body).toContain(COMMENT_MARKER);
    expect(call?.body).toContain('npm could not resolve the dependency tree');
    expect(call?.body).toContain('[view run]');

    const [stored] = await db.select().from(prComments);
    expect(stored).toMatchObject({ prNumber: 7, githubCommentId: call?.id });
  });

  it('updates the existing comment instead of posting a second one', async () => {
    const existing = {
      id: 555,
      body: `${COMMENT_MARKER}\n\n### An older failure`,
      user: { login: 'logsy-dev', type: 'Bot' },
    };

    const { github, result } = await analyzeThenComment({ comments: [existing] });

    expect(result).toMatchObject({ status: 'updated', commentId: 555 });
    expect(github.commentCalls).toEqual([expect.objectContaining({ kind: 'update', id: 555 })]);
  });

  it('ignores comments from other authors that have no marker', async () => {
    const { github, result } = await analyzeThenComment({
      comments: [
        { id: 111, body: 'Looks good to me!', user: { login: 'a-reviewer', type: 'User' } },
        { id: 112, body: 'CI is red again 😭', user: { login: 'someone', type: 'User' } },
      ],
    });

    expect(result.status).toBe('created');
    expect(github.commentCalls[0]?.kind).toBe('create');
  });

  it('finds the pull request from the commit when the webhook carried none', async () => {
    const { result } = await analyzeThenComment(
      { pullsForCommit: [{ number: 31, state: 'open' }] },
      { ...commentJob, prNumbers: [] },
    );

    expect(result).toMatchObject({ status: 'created', prNumber: 31 });
  });

  it('skips commenting when the run belongs to no pull request', async () => {
    const { github, result } = await analyzeThenComment(
      { pullsForCommit: [] },
      { ...commentJob, prNumbers: [] },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'no-pull-request' });
    expect(github.commentCalls).toEqual([]);
    expect(await db.select().from(prComments)).toHaveLength(0);
  });

  it('respects a repository that turned commenting off', async () => {
    await db
      .update(repositories)
      .set({ settings: { enabled: true, commentMode: 'off', llmEnabled: true } });

    const { github, result } = await analyzeThenComment();

    expect(result).toEqual({ status: 'skipped', reason: 'comments-disabled' });
    expect(github.commentCalls).toEqual([]);
  });

  it('reports recurrence once the same failure has happened before', async () => {
    await analyzeThenComment();
    // A second run of the same failure.
    const github = githubStub({
      jobs: [workflowJob({ id: 103, name: 'build (22)' })],
      logs: { 103: eresolveLog },
      comments: [],
    });
    const secondRun = { ...analyzeJob, runId: RUN_ID + 1 };
    await processAnalyzeRun({ db, github, log }, secondRun);
    await processPostComment({ db, github, log }, { ...commentJob, runId: RUN_ID + 1 });

    expect(github.commentCalls[0]?.body).toContain('Seen 2 times in this repository');
  });

  it('lists the other failed jobs without repeating their detail', async () => {
    const github = githubStub({
      jobs: [workflowJob({ id: 102, name: 'build (22)' }), workflowJob({ id: 104, name: 'lint' })],
      logs: {
        102: eresolveLog,
        104: ['##[group]Run eslint .', '✖ 3 problems (3 errors, 0 warnings)'].join('\n'),
      },
    });
    await processAnalyzeRun({ db, github, log }, analyzeJob);
    await processPostComment({ db, github, log }, commentJob);

    const body = github.commentCalls[0]?.body ?? '';
    expect(body).toContain('1 other failed job');
    expect(body).toContain('**lint**');
  });

  it('adds feedback links only when the instance has a public URL', async () => {
    const github = githubStub({
      jobs: [workflowJob({ id: 102 })],
      logs: { 102: eresolveLog },
    });
    await processAnalyzeRun({ db, github, log }, analyzeJob);
    await processPostComment(
      { db, github, log, feedbackBaseUrl: 'https://logsy.example.com' },
      commentJob,
    );

    expect(github.commentCalls[0]?.body).toContain('https://logsy.example.com/feedback/');
  });
});

describe('processPostComment — resolved mode', () => {
  it('switches the existing comment to passing', async () => {
    const { github } = await analyzeThenComment();
    const created = github.commentCalls[0];

    const result = await processPostComment(
      { db, github, log },
      { ...commentJob, mode: 'resolved', runId: RUN_ID + 2 },
    );

    expect(result).toMatchObject({ status: 'resolved', commentId: created?.id });
    const last = github.commentCalls.at(-1);
    expect(last?.kind).toBe('update');
    expect(last?.body).toContain('✅ CI is passing again');
    expect(last?.body).toContain(COMMENT_MARKER);
  });

  it('says nothing when there was never a failure comment', async () => {
    const github = githubStub({ comments: [] });

    const result = await processPostComment(
      { db, github, log },
      { ...commentJob, mode: 'resolved' },
    );

    expect(result).toMatchObject({ status: 'skipped', reason: 'nothing-to-resolve' });
    expect(github.commentCalls).toEqual([]);
  });
});

describe('analyze-run integration', () => {
  it('queues the comment job after storing the analyses', async () => {
    const queued: PostCommentJob[] = [];
    const github = githubStub({
      jobs: [workflowJob({ id: 102 })],
      logs: { 102: eresolveLog },
    });

    await processAnalyzeRun(
      {
        db,
        github,
        log,
        comments: {
          enqueuePostComment: (job) => {
            queued.push(job);
            return Promise.resolve();
          },
        },
      },
      analyzeJob,
    );

    expect(queued).toEqual([
      expect.objectContaining({ runId: RUN_ID, runAttempt: 1, mode: 'failure', prNumbers: [7] }),
    ]);
  });
});
