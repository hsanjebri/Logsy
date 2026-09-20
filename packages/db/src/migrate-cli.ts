import { databaseEnvSchema, loadEnv } from '@logsy/config';
import { runMigrations } from './migrate.js';

const env = loadEnv([databaseEnvSchema]);
await runMigrations(env.DATABASE_URL);
process.stdout.write('Migrations applied.\n');
