import type { AnalysisResult } from './analysis.js';
import { MIN_COMMENT_CONFIDENCE } from './analysis.js';
import type { FailureCategory } from './categories.js';

/**
 * The single PR comment. Every comment carries a hidden marker so the next run can
 * find and update it instead of posting again.
 */
export const COMMENT_MARKER = '<!-- logsy:comment -->';

const CATEGORY_LABELS: Readonly<Record<FailureCategory, string>> = {
  test_failure: '🧪 Test failure',
  build_error: '🔨 Build error',
  type_error: '🔤 Type error',
  lint_error: '🧹 Lint error',
  dependency_error: '📦 Dependency error',
  infrastructure: '☁️ Infrastructure',
  timeout: '⏱️ Timeout',
  out_of_memory: '💾 Out of memory',
  configuration: '⚙️ Configuration',
  flaky: '🎲 Flaky',
  unknown: '❓ Unknown',
};

export interface CommentContext {
  analysis: AnalysisResult;
  /** Where the analysis came from; shown in the footer for transparency. */
  source: 'rule' | 'llm' | 'cache';
  repoFullName: string;
  workflowName: string;
  jobName: string;
  stepName: string | null;
  runUrl: string;
  /** Redacted excerpt, shown when confidence is too low to explain anything. */
  errorExcerpt: string;
  /** How often this exact failure has been seen in this repository. */
  seenCount?: number;
  /** Commit the analysis applies to, so a stale comment is obvious. */
  headSha?: string;
  /** Used to link likely files to the diff. */
  prNumber?: number;
  /** Base URL of the Logsy instance, for the feedback links. */
  feedbackBaseUrl?: string;
  analysisId?: number;
  model?: string | null;
  /** e.g. "`OrderServiceTest.retries` is known flaky: 7 flips in 30 days" (Phase 8). */
  flakyNote?: string;
  /** Set when Logsy re-ran the failed jobs because the failure looked flaky. */
  rerunNote?: string;
  /** Older failures that mean the same thing, most alike first. */
  similar?: SimilarFailureRef[];
}

/** An older failure worth pointing at, found by meaning rather than by fingerprint. */
export interface SimilarFailureRef {
  title: string;
  runUrl: string;
  /** 0 to 1; shown so nobody mistakes a loose match for the same failure. */
  similarity: number;
  prNumber?: number | null;
  seenAt?: Date;
}

export function categoryLabel(category: FailureCategory): string {
  return CATEGORY_LABELS[category];
}

/** The comment posted while a run is failing. */
export function formatFailureComment(context: CommentContext): string {
  const { analysis } = context;
  const confident = analysis.confidence >= MIN_COMMENT_CONFIDENCE;

  const lines: string[] = [COMMENT_MARKER, ''];

  lines.push(
    confident ? `### ${analysis.title}` : '### CI failed',
    '',
    `${categoryLabel(analysis.category)} · **${context.jobName}**${
      context.stepName ? ` › ${context.stepName}` : ''
    } · [view run](${context.runUrl})`,
    '',
  );

  if (confident) {
    lines.push(analysis.rootCause, '');
  } else {
    // Below the confidence bar Logsy shows what failed, and says nothing more.
    lines.push(
      '_Logsy is not confident enough to explain this one, so here is the error itself._',
      '',
    );
  }

  if (context.flakyNote) {
    lines.push(`🎲 ${context.flakyNote}`, '');
  }

  if (context.rerunNote) {
    lines.push(`🔁 ${context.rerunNote}`, '');
  }

  const evidence = confident && analysis.evidence.length > 0 ? analysis.evidence : [];
  if (evidence.length > 0) {
    lines.push(...collapsible('Evidence from the log', codeBlock(evidence.join('\n'))), '');
  } else if (context.errorExcerpt.trim() !== '') {
    lines.push(...collapsible('Error excerpt', codeBlock(tail(context.errorExcerpt, 40))), '');
  }

  if (confident && analysis.likelyFiles.length > 0) {
    lines.push('**Likely files**', '');
    for (const file of analysis.likelyFiles) {
      lines.push(`- ${fileLink(file.path, file.line, context)} — ${file.reason}`);
    }
    lines.push('');
  }

  if (confident) {
    lines.push('**Suggested fix**', '', analysis.suggestedFix, '');
  }

  const notes: string[] = [];
  if (context.seenCount !== undefined && context.seenCount > 1) {
    notes.push(`Seen ${context.seenCount} times in this repository`);
  }
  if (analysis.isLikelyFlaky) {
    notes.push('This looks flaky rather than caused by your change');
  }
  if (notes.length > 0) {
    lines.push(notes.map((note) => `> ${note}`).join('\n> '), '');
  }

  const similar = context.similar ?? [];
  if (similar.length > 0) {
    lines.push('**Seen something like this before**', '');
    for (const entry of similar) {
      const when = entry.seenAt ? `, ${entry.seenAt.toISOString().slice(0, 10)}` : '';
      const pull =
        entry.prNumber === undefined || entry.prNumber === null
          ? ''
          : ` in #${String(entry.prNumber)}`;
      lines.push(
        `- [${entry.title}](${entry.runUrl})${pull}${when} · ${String(Math.round(entry.similarity * 100))}% alike`,
      );
    }
    lines.push('');
  }

  lines.push('---', '', footer(context, confident));
  return lines.join('\n');
}

/** Replaces the failure comment once the workflow passes again. */
export function formatPassingComment(context: {
  workflowName: string;
  runUrl: string;
  headSha?: string;
}): string {
  return [
    COMMENT_MARKER,
    '',
    `### ✅ ${context.workflowName} is passing again`,
    '',
    `The previously reported failure is resolved. [View run](${context.runUrl})`,
    '',
    '---',
    '',
    `<sub>${signature(context.headSha)}</sub>`,
  ].join('\n');
}

function footer(context: CommentContext, confident: boolean): string {
  const parts: string[] = [];

  if (confident) {
    const how =
      context.source === 'rule'
        ? 'matched a known failure pattern'
        : context.source === 'cache'
          ? 'reused an earlier analysis of the same error'
          : `analyzed by ${context.model ?? 'an LLM'}`;
    parts.push(`${how} · confidence ${(context.analysis.confidence * 100).toFixed(0)}%`);
  }

  const feedback = feedbackLinks(context);
  if (feedback) parts.push(feedback);
  parts.push(signature(context.headSha));

  return `<sub>${parts.join(' · ')}</sub>`;
}

function feedbackLinks(context: CommentContext): string | null {
  if (!context.feedbackBaseUrl || context.analysisId === undefined) return null;
  const base = `${context.feedbackBaseUrl.replace(/\/$/, '')}/feedback/${String(context.analysisId)}`;
  return `Was this helpful? [👍](${base}?verdict=helpful) [👎](${base}?verdict=wrong)`;
}

function signature(headSha?: string): string {
  const commit = headSha ? ` for \`${headSha.slice(0, 7)}\`` : '';
  return `[Logsy](https://github.com/hsanjebri/Logsy)${commit}`;
}

function fileLink(path: string, line: number | undefined, context: CommentContext): string {
  const label = line === undefined ? `\`${path}\`` : `\`${path}:${String(line)}\``;
  if (context.prNumber === undefined) return label;
  // Anchors into the PR's "Files changed" tab need the SHA-256 of the path, which the
  // formatter has no way to compute offline, so link the tab itself.
  return `[${label}](https://github.com/${context.repoFullName}/pull/${String(context.prNumber)}/files)`;
}

function collapsible(summary: string, body: string): string[] {
  return ['<details>', `<summary>${summary}</summary>`, '', body, '</details>'];
}

function codeBlock(text: string): string {
  return ['```', text, '```'].join('\n');
}

function tail(text: string, lines: number): string {
  return text.split('\n').slice(-lines).join('\n');
}
