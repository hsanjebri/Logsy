import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    // Integration tests share one database, so files must not run concurrently.
    fileParallelism: false,
  },
});
