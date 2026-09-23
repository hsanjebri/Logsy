import { describe, expect, it } from 'vitest';
import { createEmbeddingProvider } from './embeddings.js';

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function capturingFetch(vector: number[], calls: Captured[] = []) {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
      string,
      unknown
    >;
    calls.push({ url, body });
    return Promise.resolve(
      Response.json(
        url.includes('/api/embed')
          ? { embeddings: [vector] }
          : { data: [{ embedding: vector, index: 0 }], model: 'm', usage: {} },
      ),
    );
  };
  return { fetchImpl, calls };
}

const vector = (length: number) => Array.from({ length }, (_unused, index) => index / length);

describe('createEmbeddingProvider', () => {
  it('asks Gemini for the width the database column expects', async () => {
    const { fetchImpl, calls } = capturingFetch(vector(768));
    const provider = createEmbeddingProvider({
      provider: 'gemini',
      model: 'gemini-embedding-001',
      dimensions: 768,
      apiKey: 'test',
      fetch: fetchImpl,
    });

    await expect(provider.embed('npm ERR! ERESOLVE')).resolves.toHaveLength(768);
    expect(calls[0]?.url).toContain('generativelanguage.googleapis.com');
    expect(calls[0]?.body).toMatchObject({ model: 'gemini-embedding-001', dimensions: 768 });
  });

  it('posts to a local Ollama server, where nothing leaves the machine', async () => {
    const { fetchImpl, calls } = capturingFetch(vector(768));
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
      baseUrl: 'http://localhost:11434/',
      fetch: fetchImpl,
    });

    await expect(provider.embed('boom')).resolves.toHaveLength(768);
    expect(calls[0]?.url).toBe('http://localhost:11434/api/embed');
  });

  it('refuses a vector of the wrong width rather than corrupting the column', async () => {
    const { fetchImpl } = capturingFetch(vector(1_536));
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 768,
      apiKey: 'test',
      fetch: fetchImpl,
    });

    await expect(provider.embed('boom')).rejects.toThrow('returned 1536 dimensions, expected 768');
  });

  it('sends only the head of a long excerpt', async () => {
    const { fetchImpl, calls } = capturingFetch(vector(768));
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 768,
      apiKey: 'test',
      fetch: fetchImpl,
    });

    await provider.embed('x'.repeat(10_000));
    expect(String(calls[0]?.body.input)).toHaveLength(4_000);
  });

  it('needs a key for a hosted provider', () => {
    expect(() =>
      createEmbeddingProvider({ provider: 'openai', model: 'm', dimensions: 768 }),
    ).toThrow('API key is required');
  });
});
