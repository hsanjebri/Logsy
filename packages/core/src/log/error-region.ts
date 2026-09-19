/** Locating the region of a log that explains why the job failed. */

import type { LogStep } from './steps.js';

/**
 * Anchors are ranked. A job almost always ends with
 * `##[error]Process completed with exit code 1`, which says nothing on its own —
 * the real cause appears earlier, so cascade markers rank lowest and the first
 * root-cause match wins.
 */
export type AnchorPriority = 'root' | 'annotated' | 'cascade';

export interface ErrorAnchor {
  /** 1-based line number in the cleaned log. */
  line: number;
  text: string;
  priority: AnchorPriority;
  /** Identifier of the pattern that matched, useful for debugging and tests. */
  patternId: string;
}

export interface ErrorRegion {
  /** 1-based inclusive bounds in the cleaned log. */
  startLine: number;
  endLine: number;
  lines: string[];
  anchors: ErrorAnchor[];
  priority: AnchorPriority;
}

export interface FindErrorRegionOptions {
  /** Lines of context kept before the first anchor. */
  before?: number;
  /** Lines of context kept after the last anchor. */
  after?: number;
  /** Maximum number of anchors whose windows are merged. */
  maxAnchors?: number;
}

interface AnchorPattern {
  id: string;
  priority: AnchorPriority;
  pattern: RegExp;
}

const CASCADE =
  /^##\[error\](?:Process completed with exit code|The operation was canceled|The process '.*' failed with exit code)/;

/**
 * Lines that match an error pattern but carry no information: Maven's reactor
 * summary, bare prefixes, and separator rules.
 */
const NOISE = [
  /\.{5,}\s*(?:FAILURE|SUCCESS|SKIPPED)\s*\[/,
  /^\[ERROR\]\s*$/,
  /^\[ERROR\]\s*-{5,}/,
  /^\s*(?:=|-|_){10,}\s*$/,
];

export const ERROR_PATTERNS: readonly AnchorPattern[] = [
  // Language and tool failures that state an actual cause.
  { id: 'python_traceback', priority: 'root', pattern: /^\s*Traceback \(most recent call last\)/ },
  { id: 'pytest_failure', priority: 'root', pattern: /^(?:FAILED|ERROR) \S+::|^E\s{3}\w+Error/ },
  { id: 'pytest_summary', priority: 'root', pattern: /^=+ short test summary info =+/ },
  { id: 'jest_vitest_failure', priority: 'root', pattern: /^\s*(?:FAIL|✕|×)\s+\S+/ },
  {
    id: 'assertion',
    priority: 'root',
    pattern: /\bAssertionError\b|\bexpected .* (?:to be|but got)\b/i,
  },
  { id: 'exception', priority: 'root', pattern: /^\s*(?:[\w.]*Exception|[\w.]*Error):\s/ },
  {
    id: 'java_exception',
    priority: 'root',
    pattern: /^\s*(?:Caused by:|at [\w$.]+\([\w$.]+\.java:\d+\))/,
  },
  { id: 'maven_failure', priority: 'root', pattern: /^\[ERROR\]|BUILD FAILURE/ },
  {
    id: 'gradle_failure',
    priority: 'root',
    pattern: /^FAILURE: Build failed|^\* What went wrong:/,
  },
  { id: 'npm_error', priority: 'root', pattern: /^npm (?:ERR!|error)\s/ },
  { id: 'typescript_error', priority: 'root', pattern: /\berror TS\d{4}\b/ },
  { id: 'eslint_problem', priority: 'root', pattern: /^\s*\d+:\d+\s+error\s+\S/ },
  // pre-commit: "trim trailing whitespace...............................Failed".
  // The lookbehind anchors on the word, not the dots: matching dots first backtracks
  // catastrophically on pytest progress lines made of thousands of dots.
  { id: 'precommit_failure', priority: 'root', pattern: /(?<=\.{5})(?:Failed|Error)\s*$/ },
  { id: 'go_panic', priority: 'root', pattern: /^panic: |^\s*--- FAIL: / },
  { id: 'rust_error', priority: 'root', pattern: /^error(?:\[E\d+\])?: / },
  {
    id: 'docker_error',
    priority: 'root',
    pattern: /^(?:ERROR|failed to solve)[:\s]|toomanyrequests|denied: /,
  },
  {
    id: 'out_of_memory',
    priority: 'root',
    pattern: /JavaScript heap out of memory|OOMKilled|Killed\s*$|exit code 137/,
  },
  { id: 'disk_full', priority: 'root', pattern: /No space left on device/i },
  {
    id: 'network',
    priority: 'root',
    pattern: /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/,
  },
  { id: 'generic_error_line', priority: 'root', pattern: /^\s*(?:Error|ERROR|FATAL|fatal)[:\s]/ },

  // Runner annotations that carry a message of their own.
  { id: 'annotation', priority: 'annotated', pattern: /^##\[error\]/ },

  // Last resort: the job exited non-zero.
  {
    id: 'exit_code',
    priority: 'cascade',
    pattern: /Process completed with exit code|^##\[error\]/,
  },
];

const PRIORITY_ORDER: readonly AnchorPriority[] = ['root', 'annotated', 'cascade'];

/**
 * Very long lines (progress bars, minified output) are matched on their head and
 * tail only. Error messages live at one end or the other, and this bounds the cost
 * of every pattern, whatever is added later.
 */
const MAX_MATCH_CHARS = 600;

function probeOf(text: string): string {
  if (text.length <= MAX_MATCH_CHARS) return text;
  const half = MAX_MATCH_CHARS / 2;
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

/** All anchors in `lines`, with 1-based line numbers offset by `lineOffset`. */
export function findAnchors(lines: readonly string[], lineOffset = 0): ErrorAnchor[] {
  const anchors: ErrorAnchor[] = [];

  lines.forEach((line, index) => {
    const text = probeOf(line);
    if (NOISE.some((pattern) => pattern.test(text))) return;
    const isCascade = CASCADE.test(text);
    for (const { id, priority, pattern } of ERROR_PATTERNS) {
      if (!pattern.test(text)) continue;
      // `##[error]Process completed with exit code 1` is bookkeeping, never a cause.
      const effective: AnchorPriority = isCascade ? 'cascade' : priority;
      anchors.push({
        line: lineOffset + index + 1,
        text: line,
        priority: effective,
        patternId: id,
      });
      break;
    }
  });

  return anchors;
}

/**
 * Returns the window of log lines around the best anchors found in `step`.
 * Only anchors of the strongest priority present are used; their windows are
 * merged, and the result never leaves the step's own bounds.
 */
export function findErrorRegion(
  step: LogStep,
  options: FindErrorRegionOptions = {},
): ErrorRegion | undefined {
  const before = options.before ?? 40;
  const after = options.after ?? 20;
  const maxAnchors = options.maxAnchors ?? 5;

  const anchors = findAnchors(step.lines, step.startLine - 1);
  if (anchors.length === 0) return undefined;

  const priority = PRIORITY_ORDER.find((level) =>
    anchors.some((anchor) => anchor.priority === level),
  );
  if (!priority) return undefined;

  const selected = anchors.filter((anchor) => anchor.priority === priority).slice(0, maxAnchors);
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last) return undefined;

  const startLine = Math.max(step.startLine, first.line - before);
  const endLine = Math.min(step.endLine, last.line + after);

  return {
    startLine,
    endLine,
    lines: step.lines.slice(startLine - step.startLine, endLine - step.startLine + 1),
    anchors: selected,
    priority,
  };
}
