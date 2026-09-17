import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runMigrations, type Executor } from './client.js';
import * as schema from './schema.js';

/** Test-only helpers, exported as `@logsy/db/testing`. Never import from application code. */

const DEFAULT_TEST_DATABASE_URL = 'postgres://logsy:logsy@localhost:5432/postgres';

/**
 * Server used for test databases: TEST_DATABASE_URL, else the server from DATABASE_URL
 * (in the environment or the repo-root .env), else the docker-compose defaults.
 */
function resolveAdminUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  }
  return process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/**
 * (Re)creates a database named `name` on the test server, applies migrations and
 * returns its URL. Each package uses its own name so that packages can run their
 * test suites in parallel. The database named in the source URL is never touched.
 */
export async function createTestDatabase(name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid test database name: ${name}`);

  const adminUrl = resolveAdminUrl();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    // CREATE DATABASE fails while another session is copying template1 concurrently.
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.query(`CREATE DATABASE ${name}`);
        break;
      } catch (error) {
        if (attempt >= 10) throw error;
        await delay(200 * attempt);
      }
    }
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return url.toString();
}

const tableNames = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => `"${getTableName(table)}"`);

export async function truncateAll(db: Executor): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`));
}
