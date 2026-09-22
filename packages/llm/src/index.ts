import { createPanelProvider } from './panel.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOllamaProvider } from './providers/ollama.js';
import { createOpenAiProvider } from './providers/openai.js';
import { createRoutingProvider } from './routing.js';
import type { LlmProvider, SingleProviderName } from './types.js';

/** OpenAI-compatible endpoints, so both reuse the OpenAI adapter. */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export interface ProviderKeys {
  anthropicApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  groqApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
  ollamaBaseUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
}

export interface ProviderConfig extends ProviderKeys {
  provider: SingleProviderName;
  model: string;
}

/** Builds the provider named by configuration; the model is never hardcoded. */
export function createProvider(config: ProviderConfig): LlmProvider {
  const fetchOption = config.fetch ? { fetch: config.fetch } : {};
  switch (config.provider) {
    case 'anthropic':
      if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
      return createAnthropicProvider({
        apiKey: config.anthropicApiKey,
        model: config.model,
        ...fetchOption,
      });
    case 'openai':
      if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
      return createOpenAiProvider({
        apiKey: config.openaiApiKey,
        model: config.model,
        ...fetchOption,
      });
    case 'groq':
      if (!config.groqApiKey) throw new Error('GROQ_API_KEY is required');
      return createOpenAiProvider({
        name: 'groq',
        apiKey: config.groqApiKey,
        baseUrl: GROQ_BASE_URL,
        model: config.model,
        ...fetchOption,
      });
    case 'gemini':
      if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is required');
      return createOpenAiProvider({
        name: 'gemini',
        apiKey: config.geminiApiKey,
        baseUrl: GEMINI_BASE_URL,
        model: config.model,
        ...fetchOption,
      });
    case 'ollama':
      return createOllamaProvider({
        baseUrl: config.ollamaBaseUrl ?? 'http://localhost:11434',
        model: config.model,
        ...fetchOption,
      });
  }
}

export interface PanelMember {
  provider: SingleProviderName;
  model: string;
}

export interface LlmSettings extends ProviderKeys {
  provider: SingleProviderName;
  model?: string | undefined;
  /** Cheaper model for short logs; ignored when a panel is configured. */
  modelFast?: string | undefined;
  /** Two or more providers that analyze every failure together. */
  panel?: readonly PanelMember[] | undefined;
}

/**
 * The one place settings become a provider: a panel when configured, otherwise the
 * single provider, routed to the fast model for short logs when one is set.
 */
export function createConfiguredProvider(settings: LlmSettings): LlmProvider {
  if (settings.panel && settings.panel.length > 0) {
    return createPanelProvider({
      members: settings.panel.map((member) => createProvider({ ...settings, ...member })),
    });
  }
  if (!settings.model) throw new Error('LLM_MODEL is required unless LLM_PANEL is set');
  const primary = createProvider({ ...settings, model: settings.model });
  if (!settings.modelFast) return primary;
  // Short logs rarely need the expensive model.
  return createRoutingProvider({
    primary,
    fast: createProvider({ ...settings, model: settings.modelFast }),
  });
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
  SingleProviderName,
  Usage,
} from './types.js';
export { combinePanel, createPanelProvider, DISAGREEMENT_CONFIDENCE } from './panel.js';
export type { PanelOptions } from './panel.js';
export { analyzeLog, summarizeLogAnalysis } from './pipeline.js';
export type { AnalyzeLogOptions, LogAnalysis, LogAnalysisSummary } from './pipeline.js';
export { createRoutingProvider } from './routing.js';
export type { RoutingOptions } from './routing.js';
