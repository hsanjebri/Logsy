import { analysisResultSchema } from '@logsy/core';
import { z } from 'zod';
import { analyzeWithProvider } from '../analyze.js';
import type { AnalysisInput, CompletionFn, LlmAnalysis, LlmProvider } from '../types.js';

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

const OUTPUT_SCHEMA = z.toJSONSchema(analysisResultSchema, { target: 'draft-2020-12' });

const ollamaResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

/** Local models through Ollama; no API key, no cost. */
export function createOllamaProvider(options: OllamaProviderOptions): LlmProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/$/, '')}/api/chat`;

  const complete: CompletionFn = async ({ system, user, repair }) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        // Ollama constrains generation to a JSON Schema the same way.
        format: OUTPUT_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
          ...(repair ? [{ role: 'user', content: repair }] : []),
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: HTTP ${response.status}`);
    }

    const body = ollamaResponseSchema.parse(await response.json());
    return {
      data: safeJson(body.message.content),
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
    };
  };

  return {
    name: 'ollama',
    model: options.model,
    analyze: (input: AnalysisInput): Promise<LlmAnalysis> =>
      analyzeWithProvider(complete, input, { provider: 'ollama', model: options.model }),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
