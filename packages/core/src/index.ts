export { FAILURE_CATEGORIES, failureCategorySchema, isFailureCategory } from './categories.js';
export type { FailureCategory } from './categories.js';
export {
  MIN_COMMENT_CONFIDENCE,
  analysisResultSchema,
  isConfident,
  likelyFileSchema,
} from './analysis.js';
export type { AnalysisResult, LikelyFile } from './analysis.js';
export { REDACTION_RULES, containsSecret, redactSecrets } from './redact.js';
export type { RedactionRule } from './redact.js';
export { fingerprint, isPlaceholderFingerprint } from './fingerprint.js';
export type { FingerprintInput } from './fingerprint.js';
export { RULES, matchRule, ruleToAnalysis } from './rules.js';
export type { Rule, RuleMatch } from './rules.js';
export { cleanLog, normalizeNewlines, stripAnsi, stripTimestamps } from './log/clean.js';
export { findFailingStep, isRunnerStep, splitSteps } from './log/steps.js';
export type { LogStep } from './log/steps.js';
export { ERROR_PATTERNS, findAnchors, findErrorRegion } from './log/error-region.js';
export type {
  AnchorPriority,
  ErrorAnchor,
  ErrorRegion,
  FindErrorRegionOptions,
} from './log/error-region.js';
export { joinWithinBudget, omissionMarker, trimToBudget } from './log/trim.js';
export type { Section, TrimOptions } from './log/trim.js';
export { normalizeError } from './log/normalize.js';
export { extractFailureContext } from './log/extract.js';
export type { ExtractOptions, FailureContext } from './log/extract.js';
export {
  COMMENT_MARKER,
  categoryLabel,
  formatFailureComment,
  formatPassingComment,
} from './comment.js';
export type { CommentContext } from './comment.js';
export { buildAnnotations, checkRunSummary, checkRunTitle } from './annotations.js';
export type { AnnotationContext, CheckAnnotation } from './annotations.js';
export { parseCommentMarkdown, parseInline } from './comment-markdown.js';
export type { MarkdownBlock, MarkdownInline } from './comment-markdown.js';
export { parseJUnitFiles, parseJUnitXml } from './junit.js';
export type { TestResultRecord, TestStatus } from './junit.js';
export { detectFlakyTests, flakyNote, testKey } from './flaky.js';
export type { FlakyDetection, FlakyTestRef } from './flaky.js';
