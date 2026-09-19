import type { AnalysisResult } from '@logsy/core';
import { describe, expect, it } from 'vitest';
import { createProvider } from '../index.js';
import type { AnalysisInput } from '../types.js';

const input: AnalysisInput = {
  excerpt: '##[error]Process completed with exit code 1.\nFAIL src/app.test.ts',
  repoFullName: 'acme/api',
  workflowName: 'CI',
  jobName: 'test',
  stepName: 'npm test',
  diffSummary: 'src/app.ts (+3 -1)',
};

const result: AnalysisResult = {
  category: 'test_failure',
  title: 'One test failed',
  rootCause: 'The login test expected 200 but got 401.',
  evidence: ['FAIL src/app.test.ts'],
  likelyFiles: [{ path: 'src/app.ts', line: 12, reason: 'changed in this PR' }],
  suggestedFix: 'Update the handler to return 200.',
  isLikelyFlaky: false,
  confidence: 0.8,
};

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function capturingFetch(respond: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = typeof init?.body === 'string' ? init.body : '{}';
    const captured = { url, body: JSON.parse(raw) as Record<string, unknown> };
    calls.push(captured);
    return Promise.resolve(respond(captured));
  };
  return { fetchImpl, calls };
}

describe('anthropic provider', () => {
  it('requests structured output and reports usage', async () => {
    const { fetchImpl, calls } = capturingFetch(() =>
      Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(result) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2_400, output_tokens: 180, cache_read_input_tokens: 400 },
      }),
    );

    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-opus-5',
      anthropicApiKey: 'sk-ant-test',
      fetch: fetchImpl,
    });
    const analysis = await provider.analyze(input);

    expect(analysis.result).toEqual(result);
    expect(analysis.usage).toMatchObject({
      inputTokens: 2_400,
      outputTokens: 180,
      cachedInputTokens: 400,
    });
    // 2400 in at $5/MTok + 180 out at $25/MTok
    expect(analysis.usage.costUsd).toBeCloseTo(0.012 + 0.0045, 6);

    const body = calls[0]?.body as {
      output_config?: { format?: { type?: string } };
      model?: string;
    };
    expect(calls[0]?.url).toContain('api.anthropic.com');
    expect(body.model).toBe('claude-opus-5');
    expect(body.output_config?.format?.type).toBe('json_schema');
  });

  it('retries once when the model returns something invalid', async () => {
    let call = 0;
    const { fetchImpl } = capturingFetch(() => {
      call += 1;
      const text = call === 1 ? '{"category":"banana"}' : JSON.stringify(result);
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 10 },
      });
    });

    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-opus-5',
      anthropicApiKey: 'sk-ant-test',
      fetch: fetchImpl,
    });
    const analysis = await provider.analyze(input);

    expect(call).toBe(2);
    expect(analysis.attempts).toBe(2);
    expect(analysis.result.category).toBe('test_failure');
  });

  it('requires an API key', () => {
    expect(() => createProvider({ provider: 'anthropic', model: 'claude-opus-5' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe('openai provider', () => {
  it('uses a strict json_schema response format', async () => {
    const { fetchImpl, calls } = capturingFetch(() =>
      Response.json({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-5',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(result) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1_500, completion_tokens: 120 },
      }),
    );

    const provider = createProvider({
      provider: 'openai',
      model: 'gpt-5',
      openaiApiKey: 'sk-test',
      fetch: fetchImpl,
    });
    const analysis = await provider.analyze(input);

    expect(analysis.result).toEqual(result);
    expect(analysis.usage.costUsd).toBeCloseTo((1500 / 1e6) * 1.25 + (120 / 1e6) * 10, 6);

    const body = calls[0]?.body as {
      response_format?: { json_schema?: { strict?: boolean; schema?: Record<string, unknown> } };
    };
    expect(body.response_format?.json_schema?.strict).toBe(true);
    expect(body.response_format?.json_schema?.schema?.additionalProperties).toBe(false);
  });
});

describe('ollama provider', () => {
  it('posts to the local server and costs nothing', async () => {
    const { fetchImpl, calls } = capturingFetch(() =>
      Response.json({
        message: { role: 'assistant', content: JSON.stringify(result) },
        prompt_eval_count: 900,
        eval_count: 140,
      }),
    );

    const provider = createProvider({
      provider: 'ollama',
      model: 'llama3',
      ollamaBaseUrl: 'http://localhost:11434',
      fetch: fetchImpl,
    });
    const analysis = await provider.analyze(input);

    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(calls[0]?.body.format).toBeDefined();
    expect(analysis.result).toEqual(result);
    expect(analysis.usage).toMatchObject({ inputTokens: 900, outputTokens: 140, costUsd: 0 });
  });

  it('throws when the server is unreachable', async () => {
    const { fetchImpl } = capturingFetch(() => new Response('nope', { status: 500 }));
    const provider = createProvider({
      provider: 'ollama',
      model: 'llama3',
      fetch: fetchImpl,
    });

    await expect(provider.analyze(input)).rejects.toThrow(/HTTP 500/);
  });
});
