import { categoryLabel, isConfident } from '@logsy/core';
import type { LogAnalysis } from '@logsy/llm';

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
}

const wrap = (open: number, close: number) => (text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`;

export const COLOR: Style = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
};

const identity = (text: string) => text;
export const PLAIN: Style = {
  bold: identity,
  dim: identity,
  green: identity,
  yellow: identity,
  red: identity,
};

/** The summary block above the comment: what was found, and how it was decided. */
export function renderSummary(label: string, result: LogAnalysis, style: Style): string {
  const { context, analysis } = result;
  const confident = isConfident(analysis);
  const row = (name: string, value: string) => `  ${style.dim(name.padEnd(13))} ${value}`;

  const decidedBy =
    result.source === 'rule'
      ? `rule ${style.bold(result.ruleId ?? '?')} (no LLM call)`
      : result.source === 'llm' && result.llm
        ? `${style.bold(result.llm.model)} in ${(result.llm.latencyMs / 1000).toFixed(1)}s, ` +
          `${result.llm.usage.inputTokens + result.llm.usage.outputTokens} tokens` +
          (result.llm.fellBack ? style.red(' (no valid answer)') : '')
        : style.yellow('nothing: no rule matched and no LLM is configured');

  const verdict = confident
    ? style.green(analysis.title)
    : style.yellow('unsure, so the comment shows only the error excerpt');

  return [
    '',
    `${style.bold('Logsy')} ${style.dim('·')} ${label}`,
    '',
    row(
      'Log',
      `${context.charsOriginal.toLocaleString('en-US')} chars, kept ${context.charsExcerpt.toLocaleString('en-US')}`,
    ),
    row('Failing step', context.stepName ?? style.dim('not identified')),
    row(
      'Redacted',
      result.redactions === 0
        ? style.dim('no secrets found')
        : style.yellow(`${result.redactions} secret(s)`),
    ),
    row('Fingerprint', style.dim(result.fingerprint.slice(0, 16))),
    row('Decided by', decidedBy),
    row(
      'Category',
      `${categoryLabel(analysis.category)}  ${style.dim(`confidence ${Math.round(analysis.confidence * 100)}%`)}`,
    ),
    row('Verdict', verdict),
    '',
  ].join('\n');
}

export function renderComment(result: LogAnalysis, style: Style, width = 78): string {
  const rule = style.dim('─'.repeat(width));
  return [
    rule,
    style.dim(' PR comment preview (Markdown)'),
    rule,
    result.comment.trimEnd(),
    rule,
    '',
  ].join('\n');
}
