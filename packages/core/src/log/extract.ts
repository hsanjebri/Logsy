/** The end-to-end path from a raw job log to the excerpt Logsy analyzes. */

import { redactSecrets } from '../redact.js';
import { cleanLog } from './clean.js';
import { findErrorRegion, type ErrorRegion, type FindErrorRegionOptions } from './error-region.js';
import { normalizeError } from './normalize.js';
import { findFailingStep, splitSteps, type LogStep } from './steps.js';
import { joinWithinBudget } from './trim.js';

export interface ExtractOptions extends FindErrorRegionOptions {
  /** Character budget for the excerpt. Roughly 4 characters per token. */
  maxChars?: number;
  /** Lines of the failing step's start kept for context (the command that ran). */
  headLines?: number;
}

export interface FailureContext {
  /** Redacted, trimmed text to store and send to an LLM. */
  excerpt: string;
  /** Name of the step that failed, if one could be identified. */
  stepName: string | null;
  /** The located error region, before trimming. */
  region: ErrorRegion | undefined;
  /** Redacted and normalized top error lines; the input to fingerprinting. */
  normalizedError: string;
  charsOriginal: number;
  charsExcerpt: number;
}

const DEFAULT_MAX_CHARS = 12_000;
const NORMALIZED_ERROR_LINES = 10;

/**
 * Cleans the log, finds the failing step and the error inside it, keeps the head
 * of that step plus the error region within the budget, and redacts everything.
 * Redaction is applied last so it also covers context lines.
 */
export function extractFailureContext(
  rawLog: string,
  options: ExtractOptions = {},
): FailureContext {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const headLines = options.headLines ?? 10;

  const cleaned = cleanLog(rawLog);
  const steps = splitSteps(cleaned);
  const failingStep = findFailingStep(steps);

  if (!failingStep) {
    const excerpt = redactSecrets(
      joinWithinBudget([{ lines: cleaned.split('\n'), weight: 1 }], maxChars),
    );
    return {
      excerpt,
      stepName: null,
      region: undefined,
      normalizedError: normalizeError(topLines(excerpt, NORMALIZED_ERROR_LINES)),
      charsOriginal: rawLog.length,
      charsExcerpt: excerpt.length,
    };
  }

  const region = findErrorRegion(failingStep, options);
  const head = failingStep.lines.slice(0, headLines);
  const regionLines = region?.lines ?? failingStep.lines.slice(-60);

  // Don't repeat the head if the error region already starts at the top of the step.
  const headOverlaps =
    region !== undefined && region.startLine <= failingStep.startLine + headLines;
  const excerpt = redactSecrets(
    joinWithinBudget(
      [
        { lines: headOverlaps ? [] : head, weight: 1 },
        { lines: regionLines, weight: 4 },
      ],
      maxChars,
    ),
  );

  const errorLines = region
    ? region.lines.slice(
        Math.max(0, indexOfFirstAnchor(region)),
        Math.max(0, indexOfFirstAnchor(region)) + NORMALIZED_ERROR_LINES,
      )
    : regionLines.slice(-NORMALIZED_ERROR_LINES);

  return {
    excerpt,
    stepName: failingStep.name,
    region,
    normalizedError: normalizeError(redactSecrets(errorLines.join('\n'))),
    charsOriginal: rawLog.length,
    charsExcerpt: excerpt.length,
  };
}

function indexOfFirstAnchor(region: ErrorRegion): number {
  const first = region.anchors[0];
  return first ? first.line - region.startLine : 0;
}

function topLines(text: string, count: number): string {
  return text.split('\n').slice(0, count).join('\n');
}

export type { ErrorRegion, LogStep };
