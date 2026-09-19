import type { AnalysisInput, LlmAnalysis, LlmProvider } from './types.js';

export interface RoutingOptions {
  /** Used for anything longer or more complex than the threshold. */
  primary: LlmProvider;
  /** Cheaper model for short, simple logs. */
  fast: LlmProvider;
  /** Excerpts at or below this many characters go to the fast model. */
  fastMaxChars?: number;
}

const DEFAULT_FAST_MAX_CHARS = 2_000;

/**
 * Sends short excerpts to the cheaper model and everything else to the primary one.
 * Both must produce the same schema, so callers cannot tell the difference.
 */
export function createRoutingProvider(options: RoutingOptions): LlmProvider {
  const limit = options.fastMaxChars ?? DEFAULT_FAST_MAX_CHARS;

  return {
    name: options.primary.name,
    model: `${options.primary.model} (fast: ${options.fast.model})`,
    analyze: (input: AnalysisInput): Promise<LlmAnalysis> =>
      (input.excerpt.length <= limit ? options.fast : options.primary).analyze(input),
  };
}
