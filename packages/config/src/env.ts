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

export const llmEnvSchema = z
  .object({
    LLM_PROVIDER: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
    LLM_MODEL: z.string().min(1),
    LLM_MODEL_FAST: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'required when LLM_PROVIDER=anthropic',
      });
    }
    if (env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'required when LLM_PROVIDER=openai',
      });
    }
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
