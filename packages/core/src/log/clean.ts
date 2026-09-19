/** Cleaning raw GitHub Actions job logs into plain, line-addressable text. */

// CSI sequences (colors, cursor moves) and OSC sequences (hyperlinks, titles).
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex -- matching terminal escapes is the point
  /[]\][^]*(?:|\\)|[][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;

/** GitHub prefixes every line with an ISO timestamp and a space. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function stripTimestamps(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(TIMESTAMP_PATTERN, ''))
    .join('\n');
}

export function normalizeNewlines(text: string): string {
  // Carriage returns from progress bars would otherwise hide content when displayed.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Full cleanup: normalized newlines, no ANSI escapes, no timestamps, no trailing
 * whitespace. Line count is preserved, so line numbers stay meaningful.
 */
export function cleanLog(raw: string): string {
  return stripTimestamps(stripAnsi(normalizeNewlines(raw)))
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}
