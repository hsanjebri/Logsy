import { analysisResultSchema } from '@logsy/core';
import OpenAI from 'openai';
import { z } from 'zod';
import { analyzeWithProvider } from '../analyze.js';
import type { AnalysisInput, CompletionFn, LlmAnalysis, LlmProvider } from '../types.js';

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  maxTokens?: number;
}

// OpenAI's strict mode requires every property to be listed as required and no
// additional properties, so optional fields are expressed as nullable instead.
const OUTPUT_SCHEMA = strictify(z.toJSONSchema(analysisResultSchema, { target: 'draft-2020-12' }));

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const complete: CompletionFn = async ({ system, user, repair }) => {
    const response = await client.chat.completions.create({
      model: options.model,
      max_completion_tokens: options.maxTokens ?? 4_000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
        ...(repair ? [{ role: 'user' as const, content: repair }] : []),
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'failure_analysis', strict: true, schema: OUTPUT_SCHEMA },
      },
    });

    const text = response.choices[0]?.message.content ?? '';
    return {
      data: safeJson(text),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
  };

  return {
    name: 'openai',
    model: options.model,
    analyze: (input: AnalysisInput): Promise<LlmAnalysis> =>
      analyzeWithProvider(complete, input, { provider: 'openai', model: options.model }),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Recursively marks every property required and forbids extra ones. */
function strictify(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return {};
  const node = { ...(schema as Record<string, unknown>) };

  if (node.type === 'object' && typeof node.properties === 'object') {
    const properties = node.properties as Record<string, unknown>;
    node.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, strictify(value)]),
    );
    node.required = Object.keys(properties);
    node.additionalProperties = false;
  }
  if (node.type === 'array' && node.items) {
    node.items = strictify(node.items);
  }
  return node;
}
