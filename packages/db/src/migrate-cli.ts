import { databaseEnvSchema, loadEnv } from '@logsy/config';
import { runMigrations } from './client.js';

const env = loadEnv([databaseEnvSchema]);
await runMigrations(env.DATABASE_URL);
process.stdout.write('Migrations applied.\n');
