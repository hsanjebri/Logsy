import { z } from 'zod';
import { failureCategorySchema } from './categories.js';

/**
 * What an analysis produces, whether it came from a rule, the cache or an LLM.
 * The LLM package validates model output against this same schema, so every
 * source of an analysis is shaped identically.
 */
export const likelyFileSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  reason: z.string().min(1),
});

export const analysisResultSchema = z.object({
  category: failureCategorySchema,
  title: z.string().min(1).max(120),
  /** One to three sentences, in plain language. */
  rootCause: z.string().min(1),
  /** Exact log lines supporting the conclusion. */
  evidence: z.array(z.string()).max(5),
  likelyFiles: z.array(likelyFileSchema).max(10),
  suggestedFix: z.string().min(1),
  isLikelyFlaky: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type LikelyFile = z.infer<typeof likelyFileSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/** Below this, Logsy shows the error excerpt without a speculative cause. */
export const MIN_COMMENT_CONFIDENCE = 0.5;

export function isConfident(result: Pick<AnalysisResult, 'confidence'>): boolean {
  return result.confidence >= MIN_COMMENT_CONFIDENCE;
}
