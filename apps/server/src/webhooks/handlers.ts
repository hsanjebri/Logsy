import {
  deleteInstallation,
  findRepositoryByGithubId,
  removeRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
  type Database,
  type InstallationInput,
  type RepositoryInput,
} from '@logsy/db';
import type { AnalyzeRunQueue, PostCommentQueue, TestReportQueue } from '@logsy/queue';
import type { FastifyBaseLogger } from 'fastify';
import {
  installationEventSchema,
  installationRepositoriesEventSchema,
  workflowRunEventSchema,
  type InstallationEvent,
  type InstallationPayload,
  type InstallationRepositoriesEvent,
  type RepositoryPayload,
  type WorkflowRunEvent,
} from './payloads.js';

export type HandlerOutcome = 'processed' | 'ignored';

export interface WebhookDeps {
  db: Database;
  queue: Pick<AnalyzeRunQueue, 'enqueueAnalyzeRun'> &
    Pick<PostCommentQueue, 'enqueuePostComment'> &
    Pick<TestReportQueue, 'enqueueTestReport'>;
}

/** Dispatches a verified, deduplicated webhook. Throws ZodError on unexpected payloads. */
export async function handleWebhookEvent(
  deps: WebhookDeps,
  event: string,
  payload: unknown,
  log: FastifyBaseLogger,
): Promise<HandlerOutcome> {
  switch (event) {
    case 'installation':
      return handleInstallation(deps.db, installationEventSchema.parse(payload), log);
    case 'installation_repositories':
      return handleInstallationRepositories(
        deps.db,
        installationRepositoriesEventSchema.parse(payload),
        log,
      );
    case 'workflow_run':
      return handleWorkflowRun(deps, workflowRunEventSchema.parse(payload), log);
    default:
      log.debug({ event }, 'ignoring unsupported event');
      return 'ignored';
  }
}

/**
 * Queues analysis for a failed run. The installation and repository are refreshed from
 * the payload first, so a repository Logsy has not seen yet still works.
 */
async function handleWorkflowRun(
  { db, queue }: WebhookDeps,
  payload: WorkflowRunEvent,
  log: FastifyBaseLogger,
): Promise<HandlerOutcome> {
  const run = payload.workflow_run;
  if (payload.action !== 'completed') return 'ignored';
  if (run.conclusion !== 'failure' && run.conclusion !== 'success') {
    // Cancelled, skipped, timed out: nothing to explain and nothing to resolve.
    log.debug({ conclusion: run.conclusion }, 'run neither failed nor succeeded');
    return 'ignored';
  }
  const installation = payload.installation;
  if (!installation) {
    log.warn({ runId: run.id }, 'workflow_run without an installation; cannot call the API');
    return 'ignored';
  }

  await db.transaction(async (tx) => {
    const installationId = await upsertInstallation(tx, {
      githubInstallationId: installation.id,
      accountLogin: payload.repository.owner.login,
      accountType: payload.repository.owner.type ?? 'User',
    });
    await upsertRepositories(tx, installationId, [
      {
        githubRepoId: payload.repository.id,
        fullName: payload.repository.full_name,
        private: payload.repository.private,
      },
    ]);
  });

  const repository = await findRepositoryByGithubId(db, payload.repository.id);
  if (!repository?.settings.enabled) {
    log.info({ repo: payload.repository.full_name }, 'analysis disabled for repository');
    return 'ignored';
  }

  const [owner, repo] = payload.repository.full_name.split('/');
  const common = {
    installationId: installation.id,
    githubRepoId: payload.repository.id,
    owner: owner ?? payload.repository.owner.login,
    repo: repo ?? payload.repository.full_name,
    runId: run.id,
    runAttempt: run.run_attempt,
    workflowName: run.name ?? 'workflow',
    headSha: run.head_sha,
    htmlUrl: run.html_url,
    prNumbers: (run.pull_requests ?? []).map((pr) => pr.number),
  };

  // Test reports are collected from every completed run: flakiness can only be seen
  // by comparing a passing attempt with a failing one on the same commit.
  await queue.enqueueTestReport({
    installationId: installation.id,
    githubRepoId: payload.repository.id,
    owner: common.owner,
    repo: common.repo,
    runId: run.id,
    runAttempt: run.run_attempt,
    headSha: run.head_sha,
  });

  if (run.conclusion === 'success') {
    // Nothing to analyze; an earlier failure comment on this PR is switched to passing.
    await queue.enqueuePostComment({ ...common, mode: 'resolved' });
    log.info({ runId: run.id, repo: payload.repository.full_name }, 'queued comment resolution');
    return 'processed';
  }

  await queue.enqueueAnalyzeRun({
    ...common,
    headBranch: run.head_branch,
    event: run.event,
    conclusion: run.conclusion,
  });

  log.info(
    { runId: run.id, runAttempt: run.run_attempt, repo: payload.repository.full_name },
    'queued analyze-run',
  );
  return 'processed';
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
