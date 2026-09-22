import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The monorepo keeps one .env at its root, and Next.js only looks in this directory.
// Loading it here rather than with node --env-file: Next copies node flags into its
// workers through NODE_OPTIONS, where Node rejects that one. Set variables win.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // The dashboard reads the database directly through the workspace packages.
  transpilePackages: ['@logsy/core', '@logsy/db', '@logsy/llm', '@logsy/ui'],
  typedRoutes: true,
};

export default config;
