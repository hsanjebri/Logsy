import { categoryLabel, isConfident, parseCommentMarkdown } from '@logsy/core';
import type { LogAnalysis } from '@logsy/llm';
import { banner, gauge, panel, row } from './box.js';
import { renderMarkdown } from './markdown.js';
import type { Theme, Tone } from './theme.js';

/** The finished report: the wordmark, what Logsy found, and the comment it would post. */
export function renderReport(label: string, result: LogAnalysis, theme: Theme): string {
  return [
    ...banner(theme, 'Why your CI failed, explained.'),
    ...renderSummary(label, result, theme),
    '',
    ...renderComment(result, theme),
    '',
  ].join('\n');
}

export function renderSummary(label: string, result: LogAnalysis, theme: Theme): string[] {
  const { context, analysis } = result;
  const confident = isConfident(analysis);
  const tone: Tone = confident ? 'success' : 'warning';

  const decidedBy =
    result.source === 'rule'
      ? `${theme.bold(result.ruleId ?? '?')}${theme.dim(' · matched a rule, no model call')}`
      : result.llm
        ? `${theme.bold(result.llm.model)}${theme.dim(
            ` · ${(result.llm.latencyMs / 1000).toFixed(1)}s · ${(
              result.llm.usage.inputTokens + result.llm.usage.outputTokens
            ).toLocaleString('en-US')} tokens`,
          )}${result.llm.fellBack ? theme.danger(' · no valid answer') : ''}`
        : theme.warning('nothing: no rule matched and no model is configured');

  return panel(
    [
      `${theme.badge(categoryLabel(analysis.category), tone)}  ${gauge(analysis.confidence, theme)}`,
      '',
      confident
        ? theme.bold(analysis.title)
        : theme.warning('Not sure enough to explain it, so the comment shows the excerpt'),
      '',
      row(
        'Log',
        `${context.charsOriginal.toLocaleString('en-US')} chars → ${context.charsExcerpt.toLocaleString('en-US')} kept`,
        theme,
      ),
      row('Failing step', context.stepName ?? theme.dim('not identified'), theme),
      row(
        'Redacted',
        result.redactions === 0
          ? theme.dim('no secrets found')
          : theme.warning(
              `${String(result.redactions)} secret${result.redactions === 1 ? '' : 's'}`,
            ),
        theme,
      ),
      row('Decided by', decidedBy, theme),
      row('Fingerprint', theme.dim(result.fingerprint), theme),
    ],
    theme,
    { title: 'Analysis', note: label, tone },
  );
}

export function renderComment(result: LogAnalysis, theme: Theme): string[] {
  return panel(
    renderMarkdown(parseCommentMarkdown(result.comment), theme, theme.width - 4),
    theme,
    { title: 'Pull request comment', note: 'what Logsy would post' },
  );
}
