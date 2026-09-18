import { createTestDatabase } from '@logsy/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  project.provide('databaseUrl', await createTestDatabase('logsy_test_worker'));
}
