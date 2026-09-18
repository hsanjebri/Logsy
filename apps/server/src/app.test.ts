import { createDatabase, installations, repositories, webhookDeliveries } from '@logsy/db';
import { truncateAll } from '@logsy/db/testing';
import type { AnalyzeRunJob } from '@logsy/queue';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from './app.js';
import { signPayload } from './signature.js';
import {
  INSTALLATION_ID,
  installationAction,
  installationCreated,
  installationRepositories,
  REPO_ID,
  RUN_ID,
  workflowRunCompleted,
} from './test/fixtures.js';

const SECRET = 'test-webhook-secret-0123456789';

const { db, pool } = createDatabase(inject('databaseUrl'));
const enqueued: AnalyzeRunJob[] = [];
const queue = {
  enqueueAnalyzeRun: (job: AnalyzeRunJob) => {
    enqueued.push(job);
    return Promise.resolve();
  },
};
const app = buildApp({ db, queue, webhookSecret: SECRET });

afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  enqueued.length = 0;
  await truncateAll(db);
});

interface SendOptions {
  deliveryId?: string;
  secret?: string;
  signature?: string | null;
  body?: string;
  contentType?: string;
}

function send(event: string, payload: unknown, options: SendOptions = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json',
    'x-github-event': event,
    'x-github-delivery': options.deliveryId ?? randomUUID(),
  };
  if (options.signature !== null) {
    headers['x-hub-signature-256'] =
      options.signature ?? signPayload(options.secret ?? SECRET, body);
  }
  return app.inject({ method: 'POST', url: '/webhooks/github', headers, payload: body });
}

describe('GET /healthz', () => {
  it('reports ok when the database is reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /webhooks/github — authentication and validation', () => {
  it('returns 401 without a signature', async () => {
    const response = await send('installation', installationCreated(), { signature: null });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for a signature made with another secret', async () => {
    const response = await send('installation', installationCreated(), {
      secret: 'some-other-secret-value',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the body was tampered with after signing', async () => {
    const original = JSON.stringify(installationCreated());
    const response = await send('installation', null, {
      body: original.replace('hsanjebri/api', 'attacker/api'),
      signature: signPayload(SECRET, original),
    });
    expect(response.statusCode).toBe(401);
  });

  it('stores nothing for rejected requests', async () => {
    await send('installation', installationCreated(), { signature: 'sha256=deadbeef' });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
    expect(await db.select().from(installations)).toHaveLength(0);
  });

  it('returns 400 when the delivery header is missing', async () => {
    const body = JSON.stringify(installationCreated());
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'installation',
        'x-hub-signature-256': signPayload(SECRET, body),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for a correctly signed body that is not JSON', async () => {
    const response = await send('installation', null, { body: '{not json' });
    expect(response.statusCode).toBe(400);
  });

  it('returns 415 for non-JSON content types', async () => {
    const response = await send('installation', installationCreated(), {
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(response.statusCode).toBe(415);
  });

  it('returns 422 and marks the delivery failed for an unexpected payload shape', async () => {
    const response = await send('installation', { action: 'created', installation: {} });
    expect(response.statusCode).toBe(422);
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery?.status).toBe('failed');
  });
});

describe('POST /webhooks/github — deduplication', () => {
  it('processes a delivery once and skips duplicates', async () => {
    const deliveryId = randomUUID();
    const first = await send('installation', installationCreated(), { deliveryId });
    const second = await send('installation', installationCreated(), { deliveryId });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: 'duplicate' });

    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      deliveryId,
      event: 'installation',
      action: 'created',
      status: 'processed',
    });
  });

  it('acknowledges unsupported events and records them as ignored', async () => {
    const response = await send('star', { action: 'created' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'ignored' });
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery?.status).toBe('ignored');
  });
});

describe('POST /webhooks/github — installation events', () => {
  it('creates the installation and its repositories', async () => {
    const response = await send('installation', installationCreated());
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'processed' });

    const [installation] = await db.select().from(installations);
    expect(installation).toMatchObject({
      githubInstallationId: INSTALLATION_ID,
      accountLogin: 'hsanjebri',
      accountType: 'User',
      suspendedAt: null,
    });
    const repos = await db.select().from(repositories).orderBy(repositories.githubRepoId);
    expect(repos.map((repo) => [repo.fullName, repo.private, repo.installationId])).toEqual([
      ['hsanjebri/api', true, installation?.id],
      ['hsanjebri/web', false, installation?.id],
    ]);
  });

  it('suspends and unsuspends', async () => {
    await send('installation', installationCreated());

    await send('installation', installationAction('suspend', '2026-09-01T10:00:00Z'));
    let [installation] = await db.select().from(installations);
    expect(installation?.suspendedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');

    await send('installation', installationAction('unsuspend'));
    [installation] = await db.select().from(installations);
    expect(installation?.suspendedAt).toBeNull();
  });

  it('deletes the installation and its repositories on uninstall', async () => {
    await send('installation', installationCreated());
    await send('installation', installationAction('deleted'));

    expect(await db.select().from(installations)).toHaveLength(0);
    expect(await db.select().from(repositories)).toHaveLength(0);
  });

  it('adds and removes repositories', async () => {
    await send('installation', installationCreated());

    await send(
      'installation_repositories',
      installationRepositories(
        'added',
        [{ id: 900_000_003, full_name: 'hsanjebri/cli', private: false }],
        [],
      ),
    );
    await send(
      'installation_repositories',
      installationRepositories(
        'removed',
        [],
        [{ id: 900_000_001, full_name: 'hsanjebri/api', private: true }],
      ),
    );

    const repos = await db.select().from(repositories).orderBy(repositories.githubRepoId);
    expect(repos.map((repo) => repo.fullName)).toEqual(['hsanjebri/web', 'hsanjebri/cli']);
  });

  it('creates a missing installation when repositories are added', async () => {
    const response = await send(
      'installation_repositories',
      installationRepositories(
        'added',
        [{ id: 900_000_003, full_name: 'hsanjebri/cli', private: false }],
        [],
      ),
    );

    expect(response.statusCode).toBe(202);
    expect(await db.select().from(installations)).toHaveLength(1);
    expect(await db.select().from(repositories)).toHaveLength(1);
  });
});

describe('POST /webhooks/github — workflow_run events', () => {
  it('queues an analysis for a failed run and records the repository', async () => {
    const response = await send('workflow_run', workflowRunCompleted());

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'processed' });
    expect(enqueued).toEqual([
      {
        installationId: INSTALLATION_ID,
        githubRepoId: REPO_ID,
        owner: 'hsanjebri',
        repo: 'api',
        runId: RUN_ID,
        runAttempt: 1,
        workflowName: 'CI',
        headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
        headBranch: 'feat/queue',
        event: 'pull_request',
        conclusion: 'failure',
        htmlUrl: `https://github.com/hsanjebri/api/actions/runs/${RUN_ID}`,
        prNumbers: [7],
      },
    ]);

    // The installation and repository are learned from the run itself.
    expect(await db.select().from(installations)).toHaveLength(1);
    const [repo] = await db.select().from(repositories);
    expect(repo).toMatchObject({ githubRepoId: REPO_ID, fullName: 'hsanjebri/api', private: true });
  });

  it.each([
    ['a successful run', { conclusion: 'success' }],
    ['a cancelled run', { conclusion: 'cancelled' }],
    ['an unfinished run', { action: 'in_progress', conclusion: null }],
  ])('ignores %s', async (_name, overrides) => {
    const response = await send('workflow_run', workflowRunCompleted(overrides));

    expect(response.json()).toEqual({ status: 'ignored' });
    expect(enqueued).toEqual([]);
  });

  it('does not queue anything for a repository with analysis disabled', async () => {
    await send('workflow_run', workflowRunCompleted());
    await db
      .update(repositories)
      .set({ settings: { enabled: false, commentMode: 'single', llmEnabled: true } });
    enqueued.length = 0;

    const response = await send('workflow_run', workflowRunCompleted({ runAttempt: 2 }));

    expect(response.json()).toEqual({ status: 'ignored' });
    expect(enqueued).toEqual([]);
  });

  it('queues one job per run attempt', async () => {
    await send('workflow_run', workflowRunCompleted({ runAttempt: 1 }));
    await send('workflow_run', workflowRunCompleted({ runAttempt: 2 }));

    expect(enqueued.map((job) => job.runAttempt)).toEqual([1, 2]);
  });
});
