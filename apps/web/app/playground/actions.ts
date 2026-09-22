'use server';

import { categoryLabel, isConfident, parseCommentMarkdown } from '@logsy/core';
import { analyzeLog } from '@logsy/llm';
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
    return {
      status: 'done',
      result: {
        stepName: result.context.stepName,
        charsOriginal: result.context.charsOriginal,
        charsExcerpt: result.context.charsExcerpt,
        redactions: result.redactions,
        fingerprint: result.fingerprint,
        source: result.source,
        ruleId: result.ruleId,
        category: categoryLabel(result.analysis.category),
        confidence: result.analysis.confidence,
        confident: isConfident(result.analysis),
        title: result.analysis.title,
        llm: result.llm && {
          model: result.llm.model,
          latencyMs: result.llm.latencyMs,
          tokens: result.llm.usage.inputTokens + result.llm.usage.outputTokens,
          fellBack: result.llm.fellBack,
        },
        markdown: result.comment,
        blocks: parseCommentMarkdown(result.comment),
      },
    };
  } catch (error) {
    // Provider errors (rate limits, outages) are worth showing; the log itself is not echoed.
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      status: 'error',
      message: `The models could not be reached: ${message.slice(0, 200)}`,
    };
  }
}
