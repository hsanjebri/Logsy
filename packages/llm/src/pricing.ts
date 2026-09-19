/**
 * Published prices in US dollars per million tokens, used to estimate what each
 * analysis cost. Unknown models yield a null cost rather than a wrong number.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Anthropic (as of 2026-06)
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
  // OpenAI
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },
  'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8 },
  'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
};

/** Local models are free to run. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider?: string,
): number | null {
  if (provider === 'ollama') return 0;
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok
  );
}
