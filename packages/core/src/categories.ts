import { z } from 'zod';

/** Every failure Logsy analyzes is classified into exactly one of these categories. */
export const FAILURE_CATEGORIES = [
  'test_failure',
  'build_error',
  'type_error',
  'lint_error',
  'dependency_error',
  'infrastructure',
  'timeout',
  'out_of_memory',
  'configuration',
  'flaky',
  'unknown',
] as const;

export const failureCategorySchema = z.enum(FAILURE_CATEGORIES);

export type FailureCategory = z.infer<typeof failureCategorySchema>;

export function isFailureCategory(value: unknown): value is FailureCategory {
  return failureCategorySchema.safeParse(value).success;
}
