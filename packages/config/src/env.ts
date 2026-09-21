import { z } from 'zod';

/**
 * Env schemas are split by concern so each app validates only what it uses
 * (the server doesn't need LLM keys, the dashboard doesn't need Redis, ...).
 * Every variable is documented in `.env.example`.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' }),
});

export const githubAppEnvSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  // PEM keys are usually stored on one line in .env with literal "\n" sequences.
  GITHUB_PRIVATE_KEY: z
    .string()
    .transform((key) => key.replace(/\\n/g, '\n'))
    .refine((key) => key.includes('-----BEGIN') && key.includes('PRIVATE KEY-----'), {
      error: 'must be a PEM private key',
    }),
});

/** Only the webhook receiver needs this; API calls use {@link githubAppEnvSchema}. */
export const githubWebhookEnvSchema = z.object({
  GITHUB_WEBHOOK_SECRET: z.string().min(16, { error: 'must be at least 16 characters' }),
});

export const serverEnvSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

const LLM_PROVIDERS = ['anthropic', 'openai', 'ollama', 'groq', 'gemini'] as const;
type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Which key each provider needs; Ollama runs locally and needs none. */
const PROVIDER_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: undefined,
} as const satisfies Record<LlmProviderName, string | undefined>;

/**
 * `LLM_PANEL=groq:openai/gpt-oss-120b,gemini:gemini-flash-latest` — every member
 * analyzes each failure. Split on the first colon only: model ids contain slashes
 * and sometimes colons (`llama3:8b`).
 */
const llmPanelSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const members: { provider: LlmProviderName; model: string }[] = [];
    for (const entry of value.split(',').map((part) => part.trim())) {
      const separator = entry.indexOf(':');
      const provider = entry.slice(0, separator);
      const model = entry.slice(separator + 1).trim();
      if (separator <= 0 || model === '' || !isLlmProvider(provider)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${entry}" is not provider:model (providers: ${LLM_PROVIDERS.join(', ')})`,
        });
        return z.NEVER;
      }
      members.push({ provider, model });
    }
    if (members.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'a panel needs at least two provider:model entries',
      });
      return z.NEVER;
    }
    return members;
  });

function isLlmProvider(value: string): value is LlmProviderName {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

export const llmEnvSchema = z
  .object({
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('anthropic'),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_MODEL_FAST: z.string().min(1).optional(),
    LLM_PANEL: llmPanelSchema.optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  })
  .superRefine((env, ctx) => {
    const requireKey = (provider: LlmProviderName, reason: string) => {
      const key = PROVIDER_KEYS[provider];
      if (key !== undefined && env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required when ${reason}` });
      }
    };

    if (env.LLM_PANEL) {
      // The panel replaces LLM_PROVIDER/LLM_MODEL, so only its members need keys.
      for (const provider of new Set(env.LLM_PANEL.map((member) => member.provider))) {
        requireKey(provider, `LLM_PANEL uses ${provider}`);
      }
      return;
    }
    if (env.LLM_MODEL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_MODEL'],
        message: 'required unless LLM_PANEL is set',
      });
    }
    requireKey(env.LLM_PROVIDER, `LLM_PROVIDER=${env.LLM_PROVIDER}`);
  });

export interface EnvIssue {
  variable: string;
  message: string;
}

export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(
      [
        'Invalid environment configuration:',
        ...lines,
        'See .env.example for documentation of every variable.',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

type EnvSchema = z.ZodType<Record<string, unknown>, Record<string, unknown>>;

type MergedEnv<T extends readonly EnvSchema[]> = T extends readonly [
  infer Head extends EnvSchema,
  ...infer Rest extends EnvSchema[],
]
  ? z.output<Head> & MergedEnv<Rest>
  : unknown;

/**
 * Validates `source` against every schema and returns the merged, typed result.
 * All problems are reported at once. Values are never included in the error
 * message, because they may be secrets.
 */
export function loadEnv<const T extends readonly EnvSchema[]>(
  schemas: T,
  source: EnvSource = process.env,
): MergedEnv<T> {
  // `FOO=` in a .env file yields an empty string; treat it as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );

  const issues: EnvIssue[] = [];
  const merged: Record<string, unknown> = {};

  for (const schema of schemas) {
    const result = schema.safeParse(cleaned);
    if (result.success) {
      Object.assign(merged, result.data);
      continue;
    }
    for (const issue of result.error.issues) {
      const variable = issue.path.map(String).join('.') || '(root)';
      const missing = issue.code === 'invalid_type' && cleaned[variable] === undefined;
      issues.push({ variable, message: missing ? 'missing' : issue.message });
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  // Safe: `merged` is the union of every schema's validated output.
  return merged as MergedEnv<T>;
}

/** Both are optional: absent means the corresponding SDK is never loaded. */
export const telemetryEnvSchema = z.object({
  SENTRY_DSN: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});
