/**
 * Saves the logs of a run's failed jobs as redacted fixtures for the eval harness.
 *
 *   pnpm fixture <owner/repo> <runId> [installationId]
 *
 * Fixtures land in evals/fixtures/ as <owner>-<repo>-<runId>-<jobId>.log with a
 * .json sidecar holding the labels used by the eval harness (filled in by hand).
 */
import { containsSecret, redactSecrets } from '@logsy/core';
import { EnvValidationError, githubAppEnvSchema, loadEnv } from '@logsy/config';
import { createGitHubApp, failedStep, isFailedJob } from '@logsy/github';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../evals/fixtures', import.meta.url));

function usage(message: string): never {
  process.stderr.write(`${message}\nUsage: pnpm fixture <owner/repo> <runId> [installationId]\n`);
  process.exit(1);
}

const [slug, runIdArg, installationIdArg] = process.argv.slice(2);
if (!slug?.includes('/') || !runIdArg) usage('Missing arguments.');

const [owner, repo] = slug.split('/');
const runId = Number(runIdArg);
if (!owner || !repo || !Number.isInteger(runId)) usage('Invalid arguments.');

let env;
try {
  env = loadEnv([githubAppEnvSchema]);
} catch (error) {
  if (error instanceof EnvValidationError) usage(error.message);
  throw error;
}

const app = createGitHubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY });

const installationId = Number(installationIdArg ?? process.env.GITHUB_INSTALLATION_ID);
if (!Number.isInteger(installationId)) {
  usage('Pass the installation id as the third argument or set GITHUB_INSTALLATION_ID.');
}

const client = await app.forInstallation(installationId);
const jobs = (await client.listRunJobs({ owner, repo, runId })).filter(isFailedJob);
if (jobs.length === 0) usage(`Run ${runId} has no failed jobs.`);

await mkdir(FIXTURES_DIR, { recursive: true });

for (const job of jobs) {
  const raw = await client.downloadJobLogs({ owner, repo, jobId: job.id });
  const redacted = redactSecrets(raw);
  if (containsSecret(redacted)) {
    throw new Error(`Redaction incomplete for job ${job.id}; refusing to write the fixture.`);
  }

  const base = `${owner}-${repo}-${runId}-${job.id}`;
  await writeFile(`${FIXTURES_DIR}/${base}.log`, redacted, 'utf8');
  await writeFile(
    `${FIXTURES_DIR}/${base}.json`,
    `${JSON.stringify(
      {
        source: `${owner}/${repo}`,
        runId,
        jobId: job.id,
        jobName: job.name,
        stepName: failedStep(job)?.name ?? null,
        logChars: redacted.length,
        // Filled in by hand; used by the eval harness in Phase 5.
        expected_category: null,
        expected_root_cause_keywords: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(`Saved ${base}.log (${redacted.length} chars, from ${raw.length})\n`);
}
