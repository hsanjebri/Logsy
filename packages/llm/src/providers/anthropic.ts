import Anthropic from '@anthropic-ai/sdk';
import { analysisResultSchema } from '@logsy/core';
import { z } from 'zod';
import { analyzeWithProvider } from '../analyze.js';
import type { AnalysisInput, CompletionFn, LlmAnalysis, LlmProvider } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** low | medium | high | xhigh | max. Low keeps analyses fast and cheap. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
  maxTokens?: number;
}

/** JSON Schema for the structured output, derived from the shared Zod schema. */
const OUTPUT_SCHEMA = z.toJSONSchema(analysisResultSchema, { target: 'draft-2020-12' });

export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const complete: CompletionFn = async ({ system, user, repair }) => {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 16_000,
      system,
      output_config: {
        effort: options.effort ?? 'low',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        { role: 'user', content: user },
        ...(repair ? [{ role: 'user' as const, content: repair }] : []),
      ],
    });

    return {
      data: firstJson(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  };

  return {
    name: 'anthropic',
    model: options.model,
    analyze: (input: AnalysisInput): Promise<LlmAnalysis> =>
      analyzeWithProvider(complete, input, { provider: 'anthropic', model: options.model }),
  };
}

/** The structured output arrives as a text block holding JSON. */
function firstJson(content: Anthropic.ContentBlock[]): unknown {
  for (const block of content) {
    if (block.type !== 'text') continue;
    try {
      return JSON.parse(block.text);
    } catch {
      // Not JSON: validation will reject it and trigger the retry.
      return block.text;
    }
  }
  return null;
}
