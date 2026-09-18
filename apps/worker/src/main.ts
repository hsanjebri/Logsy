import {
  EnvValidationError,
  baseEnvSchema,
  databaseEnvSchema,
  githubAppEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@logsy/config';
import { createDatabase } from '@logsy/db';
import { createGitHubApp } from '@logsy/github';
import { analyzeRunJobSchema, createAnalyzeRunWorker, createRedisConnection } from '@logsy/queue';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { z } from 'zod';
import { processAnalyzeRun } from './analyze-run.js';

const workerEnvSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

function readEnv() {
  try {
    return loadEnv([
      baseEnvSchema,
      databaseEnvSchema,
      redisEnvSchema,
      githubAppEnvSchema,
      workerEnvSchema,
    ]);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
const log = pino({ level: env.LOG_LEVEL });
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
const github = createGitHubApp({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_PRIVATE_KEY,
  onWarning: (message) => {
    log.warn(message);
  },
});

const worker = createAnalyzeRunWorker(
  redis,
  async (job, token) => {
    const parsed = analyzeRunJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // A payload this worker cannot read will never succeed; don't burn retries on it.
      throw new UnrecoverableError(`invalid analyze-run payload: ${parsed.error.message}`);
    }

    const result = await processAnalyzeRun({ db, github, log }, parsed.data);
    if (result.retryAt) {
      await job.moveToDelayed(result.retryAt.getTime(), token);
      throw new DelayedError();
    }
    return result;
  },
  { concurrency: env.WORKER_CONCURRENCY },
);

worker.on('failed', (job, error) => {
  log.error({ jobId: job?.id, attempts: job?.attemptsMade, err: error }, 'analyze-run job failed');
});
worker.on('completed', (job) => {
  log.info({ jobId: job.id }, 'analyze-run job completed');
});

log.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');
  await worker.close();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
