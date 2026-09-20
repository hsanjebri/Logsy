import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Query helpers accept either the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DatabaseOptions {
  /** Maximum pool size. */
  max?: number;
}

export function createDatabase(url: string, options: DatabaseOptions = {}) {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

/** Throws if the database is unreachable. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
