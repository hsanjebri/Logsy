import OpenAI from 'openai';
import { z } from 'zod';
import { GEMINI_BASE_URL } from './urls.js';

/**
 * Embeddings turn an error excerpt into a vector, so a new failure can find older ones
 * that mean the same thing even when the wording differs. Every provider is asked for
 * the same width, because the database column has a fixed one.
 */

export type EmbeddingProviderName = 'openai' | 'gemini' | 'ollama';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

export interface EmbeddingOptions {
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
}

/** Characters of the excerpt that are embedded; the rest adds noise, not meaning. */
const MAX_CHARS = 4_000;

export function createEmbeddingProvider(options: EmbeddingOptions): EmbeddingProvider {
  const embed = options.provider === 'ollama' ? ollamaEmbedder(options) : openAiEmbedder(options);

  return {
    name: options.provider,
    model: options.model,
    dimensions: options.dimensions,
    embed: async (text: string) => {
      const vector = await embed(text.slice(0, MAX_CHARS));
      if (vector.length !== options.dimensions) {
        throw new Error(
          `${options.model} returned ${String(vector.length)} dimensions, expected ${String(options.dimensions)}`,
        );
      }
      return vector;
    },
  };
}

const openAiResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })).min(1),
});

/** OpenAI and Gemini both speak this; both accept the requested width. */
function openAiEmbedder(options: EmbeddingOptions): (text: string) => Promise<number[]> {
  if (!options.apiKey) throw new Error(`an API key is required for ${options.provider} embeddings`);
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl ?? (options.provider === 'gemini' ? GEMINI_BASE_URL : undefined),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return async (text) => {
    const response = await client.embeddings.create({
      model: options.model,
      input: text,
      dimensions: options.dimensions,
    });
    return openAiResponseSchema.parse(response).data[0]?.embedding ?? [];
  };
}

const ollamaResponseSchema = z.object({ embeddings: z.array(z.array(z.number())).min(1) });

/** Local models: nothing leaves the machine, and the width is the model's own. */
function ollamaEmbedder(options: EmbeddingOptions): (text: string) => Promise<number[]> {
  const base = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async (text) => {
    const response = await fetchImpl(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model, input: text }),
    });
    if (!response.ok) {
      throw new Error(`ollama embeddings failed: ${String(response.status)}`);
    }
    return ollamaResponseSchema.parse(await response.json()).embeddings[0] ?? [];
  };
}
