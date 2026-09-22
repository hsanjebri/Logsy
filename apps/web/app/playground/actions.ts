'use server';

import { analyzeLog, summarizeLogAnalysis } from '@logsy/llm';
import { z } from 'zod';
import { playgroundLlm } from './llm';
import { MAX_LOG_CHARS, type PlaygroundState } from './shared';

const inputSchema = z.object({
  log: z
    .string()
    .trim()
    .min(1, 'Paste a CI log first.')
    .max(MAX_LOG_CHARS, 'That log is too large; paste the failing job only.'),
  skipRules: z.boolean(),
});

export async function analyzePlaygroundLog(
  _previous: PlaygroundState,
  form: FormData,
): Promise<PlaygroundState> {
  const parsed = inputSchema.safeParse({
    log: form.get('log'),
    skipRules: form.get('skipRules') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const llm = playgroundLlm();
  if (parsed.data.skipRules && !llm.provider) {
    return { status: 'error', message: `Skipping the rules needs a model. ${llm.note}` };
  }

  try {
    const result = await analyzeLog(parsed.data.log, {
      llm: llm.provider,
      skipRules: parsed.data.skipRules,
      repoFullName: 'playground/example',
    });
    return { status: 'done', result: summarizeLogAnalysis(result) };
  } catch (error) {
    // Provider errors (rate limits, outages) are worth showing; the log itself is not echoed.
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      status: 'error',
      message: `The models could not be reached: ${message.slice(0, 200)}`,
    };
  }
}
