import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { installations, repositories, workflowRuns } from '../schema.js';
import { truncateAll } from '../testing.js';
import {
  deleteInstallation,
  removeRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
} from './installations.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());
beforeEach(() => truncateAll(db));

const installation = {
  githubInstallationId: 9_000_000_001,
  accountLogin: 'acme',
  accountType: 'Organization',
};

describe('installations', () => {
  it('upserts an installation idempotently and refreshes the account', async () => {
    const first = await upsertInstallation(db, installation);
    const second = await upsertInstallation(db, { ...installation, accountLogin: 'acme-renamed' });

    expect(second).toBe(first);
    const rows = await db.select().from(installations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountLogin).toBe('acme-renamed');
    expect(rows[0]?.githubInstallationId).toBe(9_000_000_001);
  });

  it('suspends and unsuspends', async () => {
    await upsertInstallation(db, installation);
    const at = new Date('2026-01-01T00:00:00Z');

    await setInstallationSuspended(db, installation.githubInstallationId, at);
    let [row] = await db.select().from(installations);
    expect(row?.suspendedAt?.toISOString()).toBe(at.toISOString());

    await setInstallationSuspended(db, installation.githubInstallationId, null);
    [row] = await db.select().from(installations);
    expect(row?.suspendedAt).toBeNull();
  });
});

describe('repositories', () => {
  it('upserts repositories with default settings and keeps settings on re-add', async () => {
    const installationId = await upsertInstallation(db, installation);
    await upsertRepositories(db, installationId, [
      { githubRepoId: 1, fullName: 'acme/api', private: true },
      { githubRepoId: 2, fullName: 'acme/web', private: false },
    ]);

    const [api] = await db.select().from(repositories).where(eq(repositories.githubRepoId, 1));
    expect(api?.settings).toEqual({ enabled: true, commentMode: 'single', llmEnabled: true });

    await db
      .update(repositories)
      .set({ settings: { enabled: false, commentMode: 'off', llmEnabled: false } })
      .where(eq(repositories.githubRepoId, 1));
    await upsertRepositories(db, installationId, [
      { githubRepoId: 1, fullName: 'acme/api-v2', private: false },
    ]);

    const [updated] = await db.select().from(repositories).where(eq(repositories.githubRepoId, 1));
    expect(updated?.fullName).toBe('acme/api-v2');
    expect(updated?.private).toBe(false);
    expect(updated?.settings.enabled).toBe(false);
  });

  it('removes repositories by GitHub id and ignores empty input', async () => {
    const installationId = await upsertInstallation(db, installation);
    await upsertRepositories(db, installationId, [
      { githubRepoId: 1, fullName: 'acme/api', private: true },
      { githubRepoId: 2, fullName: 'acme/web', private: false },
    ]);

    await removeRepositories(db, []);
    await removeRepositories(db, [1]);

    const rows = await db.select().from(repositories);
    expect(rows.map((row) => row.fullName)).toEqual(['acme/web']);
  });

  it('deleting an installation cascades to its data', async () => {
    const installationId = await upsertInstallation(db, installation);
    await upsertRepositories(db, installationId, [
      { githubRepoId: 1, fullName: 'acme/api', private: true },
    ]);
    const [repo] = await db.select().from(repositories);
    await db.insert(workflowRuns).values({
      repositoryId: repo?.id ?? 0,
      githubRunId: 42_000_000_000,
      runAttempt: 1,
      workflowName: 'CI',
      headSha: 'abc',
      event: 'push',
      htmlUrl: 'https://github.com/acme/api/actions/runs/42000000000',
    });

    await deleteInstallation(db, installation.githubInstallationId);

    expect(await db.select().from(repositories)).toHaveLength(0);
    expect(await db.select().from(workflowRuns)).toHaveLength(0);
  });
});
