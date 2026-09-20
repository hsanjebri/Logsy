import {
  EnvValidationError,
  baseEnvSchema,
  databaseEnvSchema,
  githubAppEnvSchema,
  llmEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@logsy/config';
import { createDatabase } from '@logsy/db';
import { createGitHubApp } from '@logsy/github';
import { createProvider, createRoutingProvider, type LlmProvider } from '@logsy/llm';
import {
  analyzeRunJobSchema,
  createAnalyzeRunWorker,
  createPostCommentQueue,
  createPostCommentWorker,
  createRedisConnection,
  createTestReportWorker,
  postCommentJobSchema,
  testReportJobSchema,
} from '@logsy/queue';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { z } from 'zod';
import { processAnalyzeRun } from './analyze-run.js';
import { processPostComment } from './post-comment.js';
import { processTestReport } from './test-report.js';

const workerEnvSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  /** Public URL of this Logsy instance; enables the feedback links in comments. */
  PUBLIC_URL: z.url().optional(),
  /** Set to false to run on rules alone, with no LLM configured. */
  LLM_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

/** Env errors are reported as a list and stop the process; nothing else is loggable yet. */
function readEnv<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv(() =>
  loadEnv([baseEnvSchema, databaseEnvSchema, redisEnvSchema, githubAppEnvSchema, workerEnvSchema]),
);
// LLM settings are only required when the LLM is actually enabled.
const llmEnv = env.LLM_ENABLED ? readEnv(() => loadEnv([llmEnvSchema])) : undefined;
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

function buildLlm(): LlmProvider | undefined {
  if (!llmEnv) return undefined;
  const common = {
    provider: llmEnv.LLM_PROVIDER,
    anthropicApiKey: llmEnv.ANTHROPIC_API_KEY,
    openaiApiKey: llmEnv.OPENAI_API_KEY,
    ollamaBaseUrl: llmEnv.OLLAMA_BASE_URL,
  };
  const primary = createProvider({ ...common, model: llmEnv.LLM_MODEL });
  if (!llmEnv.LLM_MODEL_FAST) return primary;
  // Short logs rarely need the expensive model.
  return createRoutingProvider({
    primary,
    fast: createProvider({ ...common, model: llmEnv.LLM_MODEL_FAST }),
  });
}

const llm = buildLlm();
if (llm) log.info({ provider: llm.name, model: llm.model }, 'llm enabled');
else log.warn('llm disabled; only cached and rule-based analyses will be produced');

const comments = createPostCommentQueue(redis);

const worker = createAnalyzeRunWorker(
  redis,
  async (job, token) => {
    const parsed = analyzeRunJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // A payload this worker cannot read will never succeed; don't burn retries on it.
      throw new UnrecoverableError(`invalid analyze-run payload: ${parsed.error.message}`);
    }

    const result = await processAnalyzeRun(
      { db, github, log, comments, ...(llm ? { llm } : {}) },
      parsed.data,
    );
    if (result.retryAt) {
      await job.moveToDelayed(result.retryAt.getTime(), token);
      throw new DelayedError();
    }
    return result;
  },
  { concurrency: env.WORKER_CONCURRENCY },
);

const commentWorker = createPostCommentWorker(
  redis,
  async (job) => {
    const parsed = postCommentJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`invalid post-comment payload: ${parsed.error.message}`);
    }
    return await processPostComment(
      { db, github, log, ...(env.PUBLIC_URL ? { feedbackBaseUrl: env.PUBLIC_URL } : {}) },
      parsed.data,
    );
  },
  // GitHub is stricter about writes than reads, so comments go out one at a time.
  { concurrency: 1 },
);

commentWorker.on('failed', (job, error) => {
  log.error({ jobId: job?.id, err: error }, 'post-comment job failed');
});

const testWorker = createTestReportWorker(
  redis,
  async (job) => {
    const parsed = testReportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`invalid test-report payload: ${parsed.error.message}`);
    }
    return await processTestReport({ db, github, log }, parsed.data);
  },
  // Artifact downloads are large; a couple at a time is plenty.
  { concurrency: 2 },
);

testWorker.on('failed', (job, error) => {
  log.error({ jobId: job?.id, err: error }, 'test-report job failed');
});

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
  await commentWorker.close();
  await testWorker.close();
  await comments.close();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
