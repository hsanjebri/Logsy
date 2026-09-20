import type { NextConfig } from 'next';

const config: NextConfig = {
  // The dashboard reads the database directly through the workspace packages.
  transpilePackages: ['@logsy/core', '@logsy/db'],
  typedRoutes: true,
};

export default config;
