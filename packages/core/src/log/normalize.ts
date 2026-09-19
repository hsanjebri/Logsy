/**
 * Normalizing an error so that the same failure produces the same text on every
 * run. Everything that varies between runs (paths, ids, timings, ports) is
 * replaced with a placeholder; the wording of the error is kept.
 */

interface NormalizeRule {
  pattern: RegExp;
  replacement: string;
}

const RULES: readonly NormalizeRule[] = [
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '<uuid>',
  },
  {
    pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    replacement: '<timestamp>',
  },
  { pattern: /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, replacement: '<time>' },
  // Windows and POSIX absolute paths, keeping the file name.
  { pattern: /(?:[A-Za-z]:\\|\\\\|\/)(?:[\w .+-]+[/\\])+([\w .+-]+)/g, replacement: '<path>/$1' },
  { pattern: /\b(?:tmp|temp)[/\\][\w.-]+/gi, replacement: '<tmp>' },
  // file.ts:12:34 and (file.java:56)
  { pattern: /:(\d+):(\d+)\b/g, replacement: ':<line>:<col>' },
  { pattern: /:(\d+)\)/g, replacement: ':<line>)' },
  { pattern: /\bline \d+\b/gi, replacement: 'line <line>' },
  { pattern: /\b0x[0-9a-f]{4,}\b/gi, replacement: '<hex>' },
  { pattern: /\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/gi, replacement: '<sha>' },
  {
    pattern: /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|mins|minutes|h|hours)\b/gi,
    replacement: '<duration>',
  },
  {
    pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+\b/g,
    replacement: '<host>:<port>',
  },
  { pattern: /\bport \d+\b/gi, replacement: 'port <port>' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '<ip>' },
  { pattern: /\bpid[ =:]\d+\b/gi, replacement: 'pid <pid>' },
  { pattern: /\b\d+(?:\.\d+)*(?:-[\w.]+)?\b(?=\s*(?:MB|KB|GB|bytes))/gi, replacement: '<size>' },
];

/** Collapses run-specific detail so identical failures normalize to identical text. */
export function normalizeError(text: string): string {
  let output = text;
  for (const { pattern, replacement } of RULES) {
    output = output.replace(pattern, replacement);
  }
  return output
    .split('\n')
    .map((line) => line.trim().replace(/\s{2,}/g, ' '))
    .filter((line) => line !== '')
    .join('\n');
}
