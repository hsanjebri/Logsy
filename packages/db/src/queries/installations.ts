import { eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { installations, repositories } from '../schema.js';

export interface InstallationInput {
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
}

export interface RepositoryInput {
  githubRepoId: number;
  fullName: string;
  private: boolean;
}

/** Inserts or refreshes an installation and returns its internal id. */
export async function upsertInstallation(db: Executor, input: InstallationInput): Promise<number> {
  const [row] = await db
    .insert(installations)
    .values(input)
    .onConflictDoUpdate({
      target: installations.githubInstallationId,
      set: { accountLogin: input.accountLogin, accountType: input.accountType },
    })
    .returning({ id: installations.id });
  if (!row) throw new Error('upsertInstallation returned no row');
  return row.id;
}

export async function setInstallationSuspended(
  db: Executor,
  githubInstallationId: number,
  suspendedAt: Date | null,
): Promise<void> {
  await db
    .update(installations)
    .set({ suspendedAt })
    .where(eq(installations.githubInstallationId, githubInstallationId));
}

/** Deletes the installation and, through cascades, every row that belongs to it. */
export async function deleteInstallation(
  db: Executor,
  githubInstallationId: number,
): Promise<void> {
  await db
    .delete(installations)
    .where(eq(installations.githubInstallationId, githubInstallationId));
}

/**
 * Inserts repositories or refreshes name/visibility/owner. Existing settings are kept,
 * so re-adding a repository does not reset its configuration.
 */
export async function upsertRepositories(
  db: Executor,
  installationId: number,
  repos: readonly RepositoryInput[],
): Promise<void> {
  if (repos.length === 0) return;
  await db
    .insert(repositories)
    .values(repos.map((repo) => ({ ...repo, installationId })))
    .onConflictDoUpdate({
      target: repositories.githubRepoId,
      set: {
        installationId: sql`excluded.installation_id`,
        fullName: sql`excluded.full_name`,
        private: sql`excluded.private`,
      },
    });
}

export async function removeRepositories(
  db: Executor,
  githubRepoIds: readonly number[],
): Promise<void> {
  if (githubRepoIds.length === 0) return;
  await db.delete(repositories).where(inArray(repositories.githubRepoId, [...githubRepoIds]));
}
