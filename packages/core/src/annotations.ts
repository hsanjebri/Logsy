import { isConfident, type AnalysisResult } from './analysis.js';
import { categoryLabel } from './comment.js';

/**
 * A check run annotation, as GitHub's Checks API takes it. Annotations are what put
 * the explanation on the exact lines in "Files changed".
 */
export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface AnnotationContext {
  analysis: AnalysisResult;
  /** Paths the pull request touches: GitHub hides annotations on anything else. */
  changedFiles: readonly string[];
  jobName: string;
  stepName: string | null;
}

/** GitHub's limits, which a rejected request would otherwise run into. */
const MAX_ANNOTATIONS = 50;
const MAX_TITLE = 255;
const MAX_MESSAGE = 64_000;

/**
 * One annotation per likely file the pull request actually changed. A guess about a
 * file nobody touched would be invisible on the diff anyway, so it stays in the
 * comment instead.
 */
export function buildAnnotations(context: AnnotationContext): CheckAnnotation[] {
  const { analysis } = context;
  if (!isConfident(analysis)) return [];

  const changed = new Set(context.changedFiles);
  const level = analysis.isLikelyFlaky ? 'warning' : 'failure';

  return analysis.likelyFiles
    .filter((file) => changed.has(file.path) && file.line !== undefined && file.line > 0)
    .slice(0, MAX_ANNOTATIONS)
    .map((file) => ({
      path: file.path,
      start_line: file.line ?? 1,
      end_line: file.line ?? 1,
      annotation_level: level,
      title: clip(analysis.title, MAX_TITLE),
      message: clip(
        [`${file.reason}.`, '', analysis.rootCause, '', `Suggested fix: ${analysis.suggestedFix}`]
          .join('\n')
          .trim(),
        MAX_MESSAGE,
      ),
    }));
}

/** The one-line summary GitHub shows beside the check's name. */
export function checkRunSummary(context: AnnotationContext): string {
  const { analysis } = context;
  const where =
    context.stepName === null ? context.jobName : `${context.jobName} › ${context.stepName}`;
  if (!isConfident(analysis)) {
    return `${categoryLabel('unknown')} · ${where} · not confident enough to explain this one`;
  }
  return `${categoryLabel(analysis.category)} · ${where} · confidence ${String(Math.round(analysis.confidence * 100))}%`;
}

export function checkRunTitle(analysis: AnalysisResult): string {
  return clip(isConfident(analysis) ? analysis.title : 'CI failed', MAX_TITLE);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
