import {
  COMMENT_MARKER,
  categoryLabel,
  extractFailureContext,
  fingerprint,
  formatFailureComment,
  isConfident,
  matchRule,
  parseCommentMarkdown,
  ruleToAnalysis,
  type AnalysisResult,
  type FailureContext,
  type MarkdownBlock,
} from '@logsy/core';
import type { LlmProvider, Usage } from './types.js';

export interface AnalyzeLogOptions {
  /** Asked when no rule matches. Without one, only rules can explain the failure. */
  llm?: LlmProvider | undefined;
  /** Send the log to the LLM even when a rule matches, to see what the model says. */
  skipRules?: boolean;
  repoFullName?: string;
  workflowName?: string;
  jobName?: string;
  /** Character budget for the excerpt; the worker's default. */
  maxChars?: number;
}

export interface LogAnalysis {
  context: FailureContext;
  fingerprint: string;
  /** Secrets replaced in the excerpt before anything else saw it. */
  redactions: number;
  source: 'rule' | 'llm' | 'none';
  ruleId: string | null;
  analysis: AnalysisResult;
  llm: { model: string; usage: Usage; latencyMs: number; fellBack: boolean } | null;
  /** The PR comment Logsy would post, without the hidden marker. */
  comment: string;
}

const DEFAULT_MAX_CHARS = 12_000;

/** Shown when nothing could explain the failure: the comment falls back to the excerpt. */
const UNEXPLAINED: AnalysisResult = {
  category: 'unknown',
  title: 'CI failed',
  rootCause: 'No rule matched and no LLM is configured.',
  evidence: [],
  likelyFiles: [],
  suggestedFix: 'Read the log excerpt.',
  isLikelyFlaky: false,
  confidence: 0,
};

/**
 * The analysis path of the worker, minus GitHub and the database: extract and redact,
 * rules first, then the LLM, then the comment. Used by the CLI and the playground.
 */
export async function analyzeLog(
  rawLog: string,
  options: AnalyzeLogOptions = {},
): Promise<LogAnalysis> {
  const context = extractFailureContext(rawLog, {
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
  });
  const id = fingerprint({ normalizedError: context.normalizedError, stepName: context.stepName });
  const repoFullName = options.repoFullName ?? 'your-org/your-repo';
  const workflowName = options.workflowName ?? 'CI';
  const jobName = options.jobName ?? 'build';

  const match = options.skipRules ? undefined : matchRule(context.excerpt);
  let source: LogAnalysis['source'] = 'none';
  let analysis = UNEXPLAINED;
  let llm: LogAnalysis['llm'] = null;

  if (match) {
    source = 'rule';
    analysis = ruleToAnalysis(match);
  } else if (options.llm) {
    const answer = await options.llm.analyze({
      excerpt: context.excerpt,
      repoFullName,
      workflowName,
      jobName,
      stepName: context.stepName,
    });
    source = 'llm';
    analysis = answer.result;
    llm = {
      model: answer.model,
      usage: answer.usage,
      latencyMs: answer.latencyMs,
      fellBack: answer.fellBack,
    };
  }

  const comment = formatFailureComment({
    analysis,
    source: source === 'rule' ? 'rule' : 'llm',
    repoFullName,
    workflowName,
    jobName,
    stepName: context.stepName,
    runUrl: `https://github.com/${repoFullName}/actions`,
    errorExcerpt: context.excerpt,
    model: llm?.model ?? null,
  }).replace(`${COMMENT_MARKER}\n\n`, '');

  return {
    context,
    fingerprint: id,
    redactions: context.excerpt.match(/\[REDACTED:/g)?.length ?? 0,
    source,
    ruleId: match?.rule.id ?? null,
    analysis,
    llm,
    comment,
  };
}

/**
 * What a user interface needs from an analysis, in plain data: the comment arrives
 * as a parsed tree, so a page or a window renders it without an HTML string.
 */
export interface LogAnalysisSummary {
  stepName: string | null;
  charsOriginal: number;
  charsExcerpt: number;
  redactions: number;
  fingerprint: string;
  source: LogAnalysis['source'];
  ruleId: string | null;
  category: string;
  confidence: number;
  confident: boolean;
  title: string;
  llm: { model: string; latencyMs: number; tokens: number; fellBack: boolean } | null;
  markdown: string;
  blocks: MarkdownBlock[];
}

export function summarizeLogAnalysis(result: LogAnalysis): LogAnalysisSummary {
  return {
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
  };
}
