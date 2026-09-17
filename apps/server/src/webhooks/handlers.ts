import {
  deleteInstallation,
  removeRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
  type Database,
  type InstallationInput,
  type RepositoryInput,
} from '@logsy/db';
import type { FastifyBaseLogger } from 'fastify';
import {
  installationEventSchema,
  installationRepositoriesEventSchema,
  type InstallationEvent,
  type InstallationPayload,
  type InstallationRepositoriesEvent,
  type RepositoryPayload,
} from './payloads.js';

export type HandlerOutcome = 'processed' | 'ignored';

/** Dispatches a verified, deduplicated webhook. Throws ZodError on unexpected payloads. */
export async function handleWebhookEvent(
  db: Database,
  event: string,
  payload: unknown,
  log: FastifyBaseLogger,
): Promise<HandlerOutcome> {
  switch (event) {
    case 'installation':
      return handleInstallation(db, installationEventSchema.parse(payload), log);
    case 'installation_repositories':
      return handleInstallationRepositories(
        db,
        installationRepositoriesEventSchema.parse(payload),
        log,
      );
    case 'workflow_run':
      // Enqueued for analysis once the queue exists (Phase 2).
      log.info('workflow_run received; analysis is not wired up yet');
      return 'ignored';
    default:
      log.debug({ event }, 'ignoring unsupported event');
      return 'ignored';
  }
}

async function handleInstallation(
  db: Database,
  payload: InstallationEvent,
  log: FastifyBaseLogger,
): Promise<HandlerOutcome> {
  const githubInstallationId = payload.installation.id;

  switch (payload.action) {
    case 'created':
    case 'new_permissions_accepted':
    case 'unsuspend':
      await db.transaction(async (tx) => {
        const installationId = await upsertInstallation(tx, toInstallation(payload.installation));
        if (payload.action === 'unsuspend') {
          await setInstallationSuspended(tx, githubInstallationId, null);
        }
        await upsertRepositories(
          tx,
          installationId,
          (payload.repositories ?? []).map(toRepository),
        );
      });
      break;
    case 'suspend':
      await db.transaction(async (tx) => {
        await upsertInstallation(tx, toInstallation(payload.installation));
        const suspendedAt = payload.installation.suspended_at;
        await setInstallationSuspended(
          tx,
          githubInstallationId,
          suspendedAt ? new Date(suspendedAt) : new Date(),
        );
      });
      break;
    case 'deleted':
      await deleteInstallation(db, githubInstallationId);
      break;
    default:
      return 'ignored';
  }

  log.info({ githubInstallationId, action: payload.action }, 'installation synced');
  return 'processed';
}

async function handleInstallationRepositories(
  db: Database,
  payload: InstallationRepositoriesEvent,
  log: FastifyBaseLogger,
): Promise<HandlerOutcome> {
  if (payload.action !== 'added' && payload.action !== 'removed') return 'ignored';

  await db.transaction(async (tx) => {
    // Upserting the installation too recovers from a missed `installation.created`.
    const installationId = await upsertInstallation(tx, toInstallation(payload.installation));
    await upsertRepositories(tx, installationId, payload.repositories_added.map(toRepository));
    await removeRepositories(
      tx,
      payload.repositories_removed.map((repo) => repo.id),
    );
  });

  log.info(
    {
      githubInstallationId: payload.installation.id,
      added: payload.repositories_added.length,
      removed: payload.repositories_removed.length,
    },
    'installation repositories synced',
  );
  return 'processed';
}

function toInstallation(installation: InstallationPayload): InstallationInput {
  const { account } = installation;
  return {
    githubInstallationId: installation.id,
    accountLogin: account?.login ?? account?.slug ?? `installation-${installation.id}`,
    accountType: account?.type ?? 'Enterprise',
  };
}

function toRepository(repo: RepositoryPayload): RepositoryInput {
  return { githubRepoId: repo.id, fullName: repo.full_name, private: repo.private };
}
