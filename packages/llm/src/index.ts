import { createAnthropicProvider } from './providers/anthropic.js';
import { createOllamaProvider } from './providers/ollama.js';
import { createOpenAiProvider } from './providers/openai.js';
import type { LlmProvider, ProviderName } from './types.js';

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
}

/** Builds the provider named by configuration; the model is never hardcoded. */
export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
      return createAnthropicProvider({
        apiKey: config.anthropicApiKey,
        model: config.model,
        ...(config.fetch ? { fetch: config.fetch } : {}),
      });
    case 'openai':
      if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
      return createOpenAiProvider({
        apiKey: config.openaiApiKey,
        model: config.model,
        ...(config.fetch ? { fetch: config.fetch } : {}),
      });
    case 'ollama':
      return createOllamaProvider({
        baseUrl: config.ollamaBaseUrl ?? 'http://localhost:11434',
        model: config.model,
        ...(config.fetch ? { fetch: config.fetch } : {}),
      });
  }
}

export { analyzeWithProvider, fallbackResult } from './analyze.js';
export { MODEL_PRICES, estimateCostUsd } from './pricing.js';
export type { ModelPrice } from './pricing.js';
export { PROMPT_VERSION, SYSTEM_PROMPT, buildRepairMessage, buildUserMessage } from './prompt.js';
export { createAnthropicProvider } from './providers/anthropic.js';
export { createOllamaProvider } from './providers/ollama.js';
export { createOpenAiProvider } from './providers/openai.js';
export type {
  AnalysisInput,
  CompletionFn,
  CompletionRequest,
  LlmAnalysis,
  LlmProvider,
  ProviderName,
  RawCompletion,
  Usage,
} from './types.js';
export { createRoutingProvider } from './routing.js';
export type { RoutingOptions } from './routing.js';
