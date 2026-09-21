import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  baseEnvSchema,
  databaseEnvSchema,
  githubAppEnvSchema,
  githubWebhookEnvSchema,
  llmEnvSchema,
  loadEnv,
  redisEnvSchema,
  serverEnvSchema,
} from './env.js';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEabc\\n-----END RSA PRIVATE KEY-----';

function captureError(fn: () => unknown): EnvValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv([baseEnvSchema], {});
    expect(env).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('merges multiple schemas into one typed object', () => {
    const env = loadEnv([baseEnvSchema, databaseEnvSchema, redisEnvSchema], {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://logsy:logsy@localhost:5432/logsy',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_URL).toBe('postgres://logsy:logsy@localhost:5432/logsy');
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('reports every missing variable at once', () => {
    const error = captureError(() => loadEnv([databaseEnvSchema, redisEnvSchema], {}));
    expect(error.issues).toEqual([
      { variable: 'DATABASE_URL', message: 'missing' },
      { variable: 'REDIS_URL', message: 'missing' },
    ]);
    expect(error.message).toContain('DATABASE_URL: missing');
    expect(error.message).toContain('.env.example');
  });

  it('treats empty strings as missing', () => {
    const error = captureError(() => loadEnv([databaseEnvSchema], { DATABASE_URL: '  ' }));
    expect(error.issues).toEqual([{ variable: 'DATABASE_URL', message: 'missing' }]);
  });

  it('rejects invalid values without leaking them into the message', () => {
    const error = captureError(() =>
      loadEnv([databaseEnvSchema], { DATABASE_URL: 'mysql://root:hunter2@db/app' }),
    );
    expect(error.issues[0]?.variable).toBe('DATABASE_URL');
    expect(error.message).not.toContain('hunter2');
  });
});

describe('GitHub env schemas', () => {
  it('coerces the app id and unescapes the private key', () => {
    const env = loadEnv([githubAppEnvSchema], {
      GITHUB_APP_ID: '123456',
      GITHUB_PRIVATE_KEY: PEM,
    });
    expect(env.GITHUB_APP_ID).toBe(123456);
    expect(env.GITHUB_PRIVATE_KEY.split('\n')).toHaveLength(3);
  });

  it('rejects a non-PEM key and a short webhook secret', () => {
    const error = captureError(() =>
      loadEnv([githubAppEnvSchema, githubWebhookEnvSchema], {
        GITHUB_APP_ID: '1',
        GITHUB_PRIVATE_KEY: 'not-a-key',
        GITHUB_WEBHOOK_SECRET: 'short',
      }),
    );
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'GITHUB_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
    ]);
    expect(error.message).not.toContain('not-a-key');
  });
});

describe('llmEnvSchema', () => {
  it('requires the API key of the selected provider', () => {
    const error = captureError(() =>
      loadEnv([llmEnvSchema], { LLM_PROVIDER: 'openai', LLM_MODEL: 'some-model' }),
    );
    expect(error.issues).toEqual([
      { variable: 'OPENAI_API_KEY', message: 'required when LLM_PROVIDER=openai' },
    ]);
  });

  it('defaults to anthropic', () => {
    const env = loadEnv([llmEnvSchema], { LLM_MODEL: 'some-model', ANTHROPIC_API_KEY: 'sk-test' });
    expect(env.LLM_PROVIDER).toBe('anthropic');
  });

  it('requires LLM_MODEL unless a panel is configured', () => {
    const error = captureError(() => loadEnv([llmEnvSchema], { ANTHROPIC_API_KEY: 'sk-test' }));
    expect(error.issues).toEqual([
      { variable: 'LLM_MODEL', message: 'required unless LLM_PANEL is set' },
    ]);
  });

  it('parses a panel, splitting each entry on its first colon only', () => {
    const env = loadEnv([llmEnvSchema], {
      LLM_PANEL: 'groq:openai/gpt-oss-120b, ollama:llama3:8b',
      GROQ_API_KEY: 'gsk-test',
    });
    expect(env.LLM_PANEL).toEqual([
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'ollama', model: 'llama3:8b' },
    ]);
  });

  it('requires the key of every panel member, and not the default provider', () => {
    const error = captureError(() =>
      loadEnv([llmEnvSchema], { LLM_PANEL: 'groq:a,gemini:b', GROQ_API_KEY: 'gsk-test' }),
    );
    expect(error.issues).toEqual([
      { variable: 'GEMINI_API_KEY', message: 'required when LLM_PANEL uses gemini' },
    ]);
  });

  it.each([
    ['a single member', 'groq:a'],
    ['an unknown provider', 'groq:a,grok:b'],
    ['a missing model', 'groq:a,gemini:'],
  ])('rejects a panel with %s', (_label, value) => {
    const error = captureError(() =>
      loadEnv([llmEnvSchema], { LLM_PANEL: value, GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k' }),
    );
    expect(error.issues[0]?.variable).toBe('LLM_PANEL');
  });

  it('does not need a key for ollama', () => {
    const env = loadEnv([llmEnvSchema], { LLM_PROVIDER: 'ollama', LLM_MODEL: 'llama3' });
    expect(env.OLLAMA_BASE_URL).toBe('http://localhost:11434');
  });
});

describe('serverEnvSchema', () => {
  it('defaults host and port and coerces PORT', () => {
    expect(loadEnv([serverEnvSchema], {})).toEqual({ HOST: '0.0.0.0', PORT: 3000 });
    expect(loadEnv([serverEnvSchema], { PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects an out-of-range port', () => {
    const error = captureError(() => loadEnv([serverEnvSchema], { PORT: '70000' }));
    expect(error.issues[0]?.variable).toBe('PORT');
  });
});
