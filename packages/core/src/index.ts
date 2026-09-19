export { FAILURE_CATEGORIES, failureCategorySchema, isFailureCategory } from './categories.js';
export type { FailureCategory } from './categories.js';
export { REDACTION_RULES, containsSecret, redactSecrets } from './redact.js';
export type { RedactionRule } from './redact.js';
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
