import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';

/**
 * Kept out of the package entry point: bundlers (the dashboard's) try to resolve the
 * migrations folder as a module when it is reachable from `index.ts`.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
