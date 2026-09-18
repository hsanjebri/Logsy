import {
  EnvValidationError,
  baseEnvSchema,
  databaseEnvSchema,
  githubWebhookEnvSchema,
  loadEnv,
  redisEnvSchema,
  serverEnvSchema,
} from '@logsy/config';
import { createDatabase } from '@logsy/db';
import { createAnalyzeRunQueue, createRedisConnection } from '@logsy/queue';
import { buildApp } from './app.js';

function readEnv() {
  try {
    return loadEnv([
      baseEnvSchema,
      serverEnvSchema,
      databaseEnvSchema,
      redisEnvSchema,
      githubWebhookEnvSchema,
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
const { db, pool } = createDatabase(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
const queue = createAnalyzeRunQueue(redis);
const app = buildApp({
  db,
  queue,
  webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  logger: { level: env.LOG_LEVEL },
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await queue.close();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start server');
  redis.disconnect();
  await pool.end();
  process.exit(1);
}
