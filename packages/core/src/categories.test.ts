import { describe, expect, it } from 'vitest';
import { FAILURE_CATEGORIES, failureCategorySchema, isFailureCategory } from './categories.js';

describe('failure categories', () => {
  it('contains every category from the spec, with unknown as the fallback', () => {
    expect(FAILURE_CATEGORIES).toHaveLength(11);
    expect(FAILURE_CATEGORIES).toContain('unknown');
  });

  it('accepts known categories and rejects anything else', () => {
    expect(isFailureCategory('out_of_memory')).toBe(true);
    expect(isFailureCategory('OOM')).toBe(false);
    expect(isFailureCategory(42)).toBe(false);
    expect(failureCategorySchema.safeParse('lint_error').success).toBe(true);
  });
});
