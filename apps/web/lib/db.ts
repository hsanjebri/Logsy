import { createDatabase } from '@logsy/db';

/**
 * One pool per process. Next.js reloads modules in development, so the instance is
 * cached on globalThis to avoid opening a new pool on every change.
 */
const globalForDb = globalThis as unknown as { logsyDb?: ReturnType<typeof createDatabase> };

const connection =
  globalForDb.logsyDb ??
  createDatabase(process.env.DATABASE_URL ?? 'postgres://logsy:logsy@localhost:5432/logsy', {
    max: 5,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.logsyDb = connection;

export const db = connection.db;
