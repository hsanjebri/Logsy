/**
 * Collects a redacted fixture from a PUBLIC repository's failed workflow run,
 * using the `gh` CLI for authentication.
 *
 *   node evals/collect-fixture.mjs <owner/repo> [ecosystem]
 *
 * Picks the most recent failed run, takes its first failed job, redacts the log
 * and writes <owner>-<repo>-<runId>-<jobId>.log plus a .json label file.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { containsSecret, redactSecrets } from '../packages/core/dist/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const gh = (path, raw = false) =>
  execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const [slug, ecosystem = 'unknown'] = process.argv.slice(2);
if (!slug?.includes('/')) throw new Error('usage: collect-fixture.mjs <owner/repo> [ecosystem]');
const [owner, repo] = slug.split('/');

const runs = JSON.parse(gh(`/repos/${slug}/actions/runs?status=failure&per_page=10`)).workflow_runs;
if (!runs?.length) throw new Error(`no failed runs in ${slug}`);

for (const run of runs) {
  const jobs = JSON.parse(
    gh(`/repos/${slug}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`),
  ).jobs;
  const job = jobs.find((j) => j.conclusion === 'failure');
  if (!job) continue;

  let raw;
  try {
    raw = gh(`/repos/${slug}/actions/jobs/${job.id}/logs`);
  } catch {
    continue; // expired logs
  }
  if (raw.length > 2_000_000) {
    console.log(`  skipping job ${job.id}: ${raw.length} chars is too large for a fixture`);
    continue;
  }

  const redacted = redactSecrets(raw);
  if (containsSecret(redacted)) throw new Error('redaction incomplete; refusing to write');

  const base = `${owner}-${repo}-${run.id}-${job.id}`;
  writeFileSync(`${FIXTURES}${base}.log`, redacted, 'utf8');
  writeFileSync(
    `${FIXTURES}${base}.json`,
    `${JSON.stringify(
      {
        source: slug,
        ecosystem,
        runId: run.id,
        jobId: job.id,
        workflowName: run.name,
        jobName: job.name,
        stepName: job.steps?.find((s) => s.conclusion === 'failure')?.name ?? null,
        logChars: redacted.length,
        expected_category: null,
        expected_root_cause_keywords: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`saved ${base}.log (${redacted.length} chars) — ${job.name} / ${run.name}`);
  process.exit(0);
}
throw new Error(`no usable failed job with logs in ${slug}`);
